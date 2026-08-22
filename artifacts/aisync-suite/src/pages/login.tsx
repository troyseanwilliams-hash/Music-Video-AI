import { useLocation, Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Sparkles, Loader2, Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import {
  getGetCurrentAuthUserQueryKey,
  useLoginUser,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useSEO } from "@/hooks/useSEO";
import { apiErrorMessage } from "@/lib/api-error";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const searchParams = new URLSearchParams(window.location.search);
  const requestedReturn = searchParams.get("returnTo");
  const returnTo =
    requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//")
      ? requestedReturn
      : "/";

  useSEO({
    title: "Log in — AISync Suite",
    description: "Sign in to manage your AISync Suite subscription.",
    canonical: "/login",
    noindex: true,
  });

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const loginUser = useLoginUser();

  function onSubmit(values: z.infer<typeof loginSchema>) {
    loginUser.mutate({ data: values }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetCurrentAuthUserQueryKey(),
        });
        setLocation(returnTo);
      },
      onError: (error) => {
        toast({
          title: "Login Failed",
          description: apiErrorMessage(
            error,
            "Please check your credentials and try again.",
          ),
          variant: "destructive",
        });
      }
    });
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-[128px] pointer-events-none" />

      <Card className="w-full max-w-md border-border/50 bg-card/50 backdrop-blur-xl shadow-2xl relative z-10 animate-in fade-in zoom-in-95 duration-500">
        <CardHeader className="space-y-3 text-center pt-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-electric text-white shadow-glow mb-2">
            <Sparkles className="h-6 w-6" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">Welcome back</CardTitle>
          <CardDescription>
            Sign in to your AISync Suite account
          </CardDescription>
        </CardHeader>
        <CardContent className="px-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          className="pl-10 h-12"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex justify-between items-center">
                      <span>Password</span>
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                        <Input
                          type="password"
                          autoComplete="current-password"
                          placeholder="••••••••"
                          className="pl-10 h-12"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-semibold" 
                variant="electric" 
                disabled={loginUser.isPending}
              >
                {loginUser.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : null}
                Sign in
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex flex-col gap-4 pb-8">
          <div className="text-sm text-center text-muted-foreground">
            Don't have an account?{" "}
            <Link href={`/register?returnTo=${encodeURIComponent(returnTo)}`} className="text-primary font-semibold hover:underline">
              Create one
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
