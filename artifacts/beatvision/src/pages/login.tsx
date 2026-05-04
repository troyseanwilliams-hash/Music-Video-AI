import { useEffect } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Video, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Auth context will handle redirects, but we provide a clean UI for the actual login button
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md p-8 rounded-2xl bg-card border border-card-border shadow-2xl relative z-10 mx-4"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-electric shadow-glow mb-6">
            <Video className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome to BeatVision AI</h1>
          <p className="text-muted-foreground">Sign in to start creating professional AI music videos</p>
        </div>

        <Button 
          size="lg" 
          className="w-full h-14 text-lg bg-white text-black hover:bg-gray-200 transition-colors"
          onClick={login}
        >
          Log in to Continue
        </Button>
        
        <p className="text-center text-xs text-muted-foreground mt-6">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </motion.div>
    </div>
  );
}
