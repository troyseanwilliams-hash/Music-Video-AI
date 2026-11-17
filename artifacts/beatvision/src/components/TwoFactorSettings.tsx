import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTwoFactor, updateTwoFactor, type TwoFactorInput, type TwoFactorResult } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2, Download } from "lucide-react";

export function TwoFactorSettings({ userId }: { userId: string }) {
  const client = useQueryClient();
  const queryKey = ["two-factor", userId];
  const status = useQuery({ queryKey, queryFn: () => getTwoFactor({ credentials: "include" }), staleTime: 0, refetchOnWindowFocus: true });
  const [action, setAction] = useState<TwoFactorInput["action"] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<TwoFactorResult | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: (input: TwoFactorInput) => updateTwoFactor(input, { credentials: "include" }),
    onSuccess: (result, input) => {
      if (input.action === "setup") {
        setSetup(result);
        setAction("enable");
        setCode("");
      } else {
        setPassword(""); setCode(""); setSetup(null); setAction(null);
        setRecoveryCodes(result.recoveryCodes ?? []);
        setSaved(false);
        setMessage(result.enabled ? "Two-factor authentication is enabled. Other signed-in sessions have been signed out." : "Two-factor authentication is now off. Other signed-in sessions have been signed out.");
        void client.invalidateQueries({ queryKey });
      }
    },
  });

  function start(next: TwoFactorInput["action"]) {
    setAction(next); setPassword(""); setCode(""); setSetup(null); setMessage(""); mutation.reset();
  }

  function downloadCodes() {
    const blob = new Blob([`AIBeatSync recovery codes\nKeep these private. Each code works once.\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "aibeatsync-recovery-codes.txt"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <Card className="mb-6 bg-card/50 border-card-border">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-primary" /> Two-factor authentication</CardTitle>
      <CardDescription>Optional extra protection for your account. Use Google Authenticator, Microsoft Authenticator, or another compatible app.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {status.isLoading ? <p role="status">Loading security settings…</p> : status.isError ? <div role="alert">
        <p>Couldn’t load security settings.</p><Button variant="outline" onClick={() => void status.refetch()}>Try again</Button>
      </div> : <p className="text-sm font-medium">{status.data?.enabled ? `Enabled · ${status.data.recoveryCodesRemaining} recovery codes remaining` : "Not enabled — your sign-in is unchanged."}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {!!recoveryCodes.length ? <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">Save your recovery codes</h3>
        <p className="text-sm text-muted-foreground">These codes are shown only now. Store them somewhere private, separate from your phone. Each code can be used once. Any previous recovery codes no longer work.</p>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs leading-6" aria-label="Recovery codes">{recoveryCodes.join("\n")}</pre>
        <Button type="button" variant="outline" onClick={downloadCodes}><Download className="mr-2 h-4 w-4" /> Download codes</Button>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1" /> I saved these codes somewhere safe.
        </label>
        <Button disabled={!saved} onClick={() => setRecoveryCodes([])}>Done</Button>
      </div> : action ? <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate({ action, password, ...(code ? { code } : {}) });
      }}>
        {setup?.secret && <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">Add AIBeatSync to your authenticator</h3>
          {setup.qrCode && <img src={setup.qrCode} width={240} height={240} alt="Scan this QR code with your authenticator app" className="max-w-full rounded" />}
          <p className="text-sm">On the same phone? Add a new account in your authenticator using this setup key:</p>
          <code className="block break-all select-all rounded bg-muted p-3 text-sm">{setup.secret}</code>
          <p className="text-xs text-muted-foreground">Choose time-based codes. Keep this key private. Setup expires after 10 minutes. Two-factor authentication stays off until you confirm a code.</p>
        </div>}
        {action === "disable" && <p className="text-sm">Turning this off removes the extra sign-in protection and invalidates all recovery codes.</p>}
        {action === "recovery" && <p className="text-sm">Creating new recovery codes invalidates all previous recovery codes.</p>}
        <div className="space-y-2">
          <Label htmlFor="mfa-password">Current password</Label>
          <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={1024} />
        </div>
        {action !== "setup" && <div className="space-y-2">
          <Label htmlFor="mfa-code">{action === "enable" ? "Authenticator code" : "Authenticator or recovery code"}</Label>
          <Input id="mfa-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode={action === "enable" ? "numeric" : "text"} required maxLength={64} />
          <p className="text-xs text-muted-foreground">If you just used an authenticator code, wait for the next one.</p>
        </div>}
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message || "Couldn’t update security settings."}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {action === "setup" ? "Set up authenticator" : action === "enable" ? "Confirm and enable" : action === "disable" ? "Turn off two-factor" : "Create new recovery codes"}
          </Button>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => { setAction(null); setSetup(null); setPassword(""); setCode(""); mutation.reset(); }}>Cancel</Button>
        </div>
      </form> : status.data && <div className="flex flex-wrap gap-2">
        {status.data.enabled ? <>
          <Button variant="outline" onClick={() => start("recovery")}>Replace recovery codes</Button>
          <Button variant="outline" onClick={() => start("disable")}>Turn off two-factor</Button>
        </> : <Button onClick={() => start("setup")}>Enable two-factor authentication</Button>}
      </div>}
      <p className="text-xs text-muted-foreground">If you lose your authenticator, use a recovery code to sign in. Resetting your password does not remove two-factor authentication.</p>
    </CardContent>
  </Card>;
}
