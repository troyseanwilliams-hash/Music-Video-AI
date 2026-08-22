export type SuiteOrigin = "aibeatsync" | "aipodsync" | "aisyncsuite";

export function suitePagePath(origin: SuiteOrigin): "/" | "/suite" {
  return origin === "aisyncsuite" ? "/" : "/suite";
}

export function suiteReturnBase(
  origin: SuiteOrigin,
  requestBase: string,
  aipodBase: string,
): string {
  return origin === "aipodsync" ? aipodBase : requestBase;
}