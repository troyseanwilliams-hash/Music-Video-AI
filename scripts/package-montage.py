"""Create a code-only Montage migration archive without reading environment values."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "generated-artifacts" / "montage-studio-migration.zip"
files = {}
pending = []
unresolved = []
external = set()
processed = set()
packages = {}
for base in ("lib", "artifacts"):
    for manifest in (ROOT / base).glob("*/package.json"):
        data = json.loads(manifest.read_text())
        packages[data["name"]] = (manifest.parent, data)


def add(path, prefix="source"):
    path = path.resolve()
    relative = path.relative_to(ROOT)
    if path.is_symlink() or any(p in {"node_modules", "dist", ".git"} for p in relative.parts):
        raise ValueError(f"Forbidden path: {relative}")
    if path.name.startswith(".env") or path.suffix.lower() in {".pem", ".key"}:
        raise ValueError(f"Credential file: {relative}")
    files[f"{prefix}/{relative}"] = path
    if prefix == "source" and path.suffix in {".ts", ".tsx", ".js", ".mjs"}:
        pending.append(path)


def tree(base):
    for path in sorted(base.rglob("*")):
        if path.is_file() and not any(p in {"node_modules", "dist", ".git"} for p in path.parts):
            if path.suffix in {".ts", ".tsx", ".js", ".mjs", ".json", ".yaml", ".css"} and not path.name.endswith(".tsbuildinfo"):
                add(path)


def resolve(base):
    candidates = [base, *[Path(str(base) + ext) for ext in (".ts", ".tsx", ".js", ".json")]]
    if base.suffix == ".js":
        candidates += [base.with_suffix(".ts"), base.with_suffix(".tsx")]
    candidates += [base / "index.ts", base / "index.tsx"]
    return next((p for p in candidates if p.is_file()), None)


for name in (
    "artifacts/beatvision/src/pages/editor.tsx",
    "artifacts/beatvision/src/index.css",
    "artifacts/beatvision/vitest.config.ts",
    "artifacts/api-server/src/routes/studio.ts",
):
    add(ROOT / name)
tree(ROOT / "artifacts/beatvision/src/components/montage")
for path in (ROOT / "artifacts/api-server/src/lib").glob("editor*.ts"):
    add(path)
for service in ("api-server", "worker"):
    add(ROOT / f"artifacts/{service}/src/lib/jobProcessor.ts", "reference")
    for path in (ROOT / f"artifacts/{service}/src/lib").glob("editor*.ts"):
        add(path)
    for path in (ROOT / f"artifacts/{service}/fonts").glob("*"):
        if path.is_file():
            add(path)
tree(ROOT / "lib/api-spec")
for name in ("pnpm-workspace.yaml", "tsconfig.base.json"):
    add(ROOT / name)
for folder in ("beatvision", "api-server", "worker"):
    for name in ("package.json", "tsconfig.json"):
        path = ROOT / "artifacts" / folder / name
        if path.exists():
            add(path)

imports = re.compile(r"""(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']""")
included_packages = set()
while pending:
    path = pending.pop()
    if path in processed:
        continue
    processed.add(path)
    for spec in imports.findall(path.read_text()):
        target = None
        if spec.startswith("."):
            target = resolve(path.parent / spec)
        elif spec.startswith("@/"):
            target = resolve(ROOT / "artifacts/beatvision/src" / spec[2:])
        elif spec.startswith("@workspace/"):
            package_name = "/".join(spec.split("/")[:2])
            if package_name not in packages:
                unresolved.append({"file": str(path.relative_to(ROOT)), "import": spec})
                continue
            if package_name not in included_packages:
                included_packages.add(package_name)
                tree(packages[package_name][0])
            continue
        else:
            external.add(spec)
            continue
        if target:
            add(target)
        else:
            unresolved.append({"file": str(path.relative_to(ROOT)), "import": spec})

# Refuse common embedded credential formats; never read environment values.
secret = re.compile(rb"(?:sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)")
inventory = []
OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
    for name, path in sorted(files.items()):
        data = path.read_bytes()
        if secret.search(data):
            raise ValueError(f"Possible embedded credential in {path.relative_to(ROOT)}")
        archive.writestr(name, data)
        inventory.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    for name in ("README.md", "INTEGRATION.md"):
        archive.writestr(name, (ROOT / "docs/montage-port" / name).read_bytes())
    archive.writestr("FILES.json", json.dumps(inventory, indent=2))
    archive.writestr("DEPENDENCIES.json", json.dumps({
        "note": "Source migration kit, not a standalone runnable app. Worker reference dependencies must be adapted to the target.",
        "externalImports": sorted(external),
        "unresolvedSourceImports": unresolved,
        "workspacePackages": {key: packages[key][1] for key in sorted(included_packages)},
    }, indent=2))
with zipfile.ZipFile(OUT) as archive:
    assert archive.testzip() is None
    for item in inventory:
        assert hashlib.sha256(archive.read(item["path"])).hexdigest() == item["sha256"]
print(json.dumps({"archive": str(OUT.relative_to(ROOT)), "files": len(inventory), "bytes": OUT.stat().st_size, "unresolved": unresolved}, indent=2))
