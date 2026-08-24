import { Sparkles } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-card/50 py-12 mt-auto">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 font-bold text-xl mb-4">
              <Sparkles className="h-5 w-5 text-primary" />
              <span>AISync Suite</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              The unified subscription for creators. Dedicated credits for AIBeatSync and AIPodSync, managed from one dashboard.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Products</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="/aibeatsync/" className="hover:text-primary transition-colors">AIBeatSync</a></li>
              <li><a href="https://aipodsync.com" className="hover:text-accent transition-colors">AIPodSync</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="https://aibeatsync.com/terms" className="hover:text-primary transition-colors">Terms of Service</a></li>
              <li><a href="https://aibeatsync.com/privacy" className="hover:text-primary transition-colors">Privacy Policy</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/40 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AISync Suite. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
