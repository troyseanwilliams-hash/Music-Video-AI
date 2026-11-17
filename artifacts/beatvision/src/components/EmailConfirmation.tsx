import { useEffect, useState } from "react";
import { confirmAccountEmail, type EmailConfirmationInput } from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MailCheck, Loader2 } from "lucide-react";

export function EmailConfirmation({ email, emailSent, onBack }: { email: string; emailSent?: boolean; onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [cooldown, setCooldown] = useState(emailSent === undefined ? 0 : 60);
  const [message, setMessage] = useState(emailSent === false
    ? "Your account was created, but we couldn’t send its confirmation email. Wait one minute, then request a new code below."
    : emailSent ? "Check your inbox and spam folder for your confirmation code."
      : "Confirm your email before signing in. Use the code from your sign-up email, or request a new one.");
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const mutation = useMutation({
    mutationFn: (action: EmailConfirmationInput["action"]) => confirmAccountEmail({ action, email, password, ...(action === "confirm" ? { code } : {}) }, { credentials: "include" }),
    onSuccess: (result) => {
      if (result.verified) {
        setVerified(true); setPassword(""); setCode("");
      } else {
        setCooldown(60);
        setMessage(result.emailSent ? "A new code was sent. Only the newest code will work." : "We couldn’t send the email. Wait one minute and try again. If this continues, contact support.");
      }
    },
  });
  return <main className="mx-auto flex min-h-[70vh] max-w-lg items-center px-4 py-10">
    <section className="w-full space-y-5 rounded-2xl border bg-card p-6">
      <MailCheck className="h-9 w-9 text-primary" />
      <h1 className="text-2xl font-bold">{verified ? "Email confirmed" : "Confirm your email"}</h1>
      {verified ? <>
        <p>Your email address is confirmed. Sign in to start using your account.</p>
        <Button onClick={onBack}>Continue to sign in</Button>
      </> : <>
        <p className="break-words text-sm">Account: <strong>{email}</strong></p>
        <p role="status" className="text-sm text-muted-foreground">{message}</p>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate("confirm"); }}>
          <div className="space-y-2">
            <Label htmlFor="confirm-email-password">Account password</Label>
            <Input id="confirm-email-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={1024} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-email-code">8-digit email code</Label>
            <Input id="confirm-email-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
            <p className="text-xs text-muted-foreground">Codes expire after 15 minutes. Confirming your email is required; authenticator two-factor remains optional.</p>
          </div>
          {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
          <Button className="w-full" disabled={mutation.isPending || code.length !== 8 || !password} type="submit">
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm email
          </Button>
          <Button className="w-full" variant="outline" type="button" disabled={mutation.isPending || cooldown > 0 || !password} onClick={() => mutation.mutate("resend")}>
            {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend confirmation code"}
          </Button>
          <p className="text-xs text-muted-foreground">Enter your account password to resend a code. You can return to this step by signing in again. If you entered the wrong email, go back and sign up with the correct address.</p>
        </form>
        <Button variant="link" className="px-0" disabled={mutation.isPending} onClick={onBack}>Back to sign in</Button>
      </>}
    </section>
  </main>;
}
