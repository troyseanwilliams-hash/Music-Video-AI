import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { buildAuthUrl } from "@/lib/authIntent";
import { track } from "@/lib/analytics";
import { Wand2, Image as ImageIcon, ArrowRight, Info } from "lucide-react";

export function PhotoAnimationShowcase() {
  const { isAuthenticated } = useAuth();
  
  const ctaPath = isAuthenticated 
    ? "/gallery?tab=images&action=animate" 
    : buildAuthUrl("/register", { returnTo: "/gallery?tab=images&action=animate" });

  return (
    <section className="py-20 md:py-24 border-y border-white/5 bg-[#030303] relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary/10 rounded-[100%] blur-[120px] pointer-events-none z-0" />
      
      <div className="container px-4 md:px-6 mx-auto max-w-6xl relative z-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          
          <div className="lg:col-span-5 order-2 lg:order-1 flex flex-col items-start text-left">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 mb-6 backdrop-blur-md">
              <Wand2 className="mr-2 h-3.5 w-3.5 text-primary" />
              Image to Video
            </div>
            
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight mb-6 text-white leading-tight">
              Bring a photo <br className="hidden lg:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">to life.</span>
            </h2>
            
            <p className="text-base md:text-lg text-white/60 mb-6 leading-relaxed">
              Transform any still image into a dynamic video. <strong>Animate a single photo</strong> for a quick 5 or 10-second clip, or jump into <strong>Narrative Video</strong> to tell a story across multiple scenes.
            </p>
            
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-8 text-sm text-white/70 w-full flex items-start gap-3">
              <Info className="w-5 h-5 text-white/40 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-white mb-1">How it works</p>
                <p>Upload a photo or generate one in our studio, approve the aesthetic, and use credits to animate it. Finished videos are saved to your gallery for discovery and editing.</p>
              </div>
            </div>

            <Link href={ctaPath} onClick={() => track("cta_click", { location: "photo_animate_showcase", action: "open_gallery_animate", label: "Animate a photo" })} className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto h-12 md:h-14 px-6 md:px-8 bg-white text-black hover:bg-white/90 shadow-[0_0_30px_rgba(255,255,255,0.15)] border-0 rounded-full group">
                <ImageIcon className="mr-2 h-5 w-5" />
                Animate a photo
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
          
          <div className="lg:col-span-7 order-1 lg:order-2">
            <div className="grid sm:grid-cols-2 gap-6 relative">
              {/* Before: Photo */}
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-white/10 bg-[#07070a] shadow-xl overflow-hidden aspect-video relative group">
                  <img 
                    src="/photo-animation-demo.jpg" 
                    alt="Original still photo" 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-3 py-1 flex items-center shadow-lg">
                    <span className="text-[10px] font-bold tracking-wider text-white uppercase">Before</span>
                  </div>
                </div>
                <p className="text-[11px] text-center text-white/50 font-semibold tracking-wide uppercase">Source Image</p>
              </div>

              {/* After: Video */}
              <div className="flex flex-col gap-3 mt-4 sm:mt-0 sm:translate-y-8">
                <div className="rounded-2xl border border-primary/30 bg-[#07070a] shadow-[0_0_40px_rgba(var(--primary-rgb),0.1)] overflow-hidden aspect-video relative ring-1 ring-primary/10">
                  <video 
                    poster="/photo-animation-demo.jpg"
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full h-full object-cover"
                  >
                    <source src="/photo-animation-demo.webm" type="video/webm" />
                    <source src="/photo-animation-demo.mp4" type="video/mp4" />
                    Your browser does not support video playback.
                  </video>
                  <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-3 py-1 flex items-center shadow-lg pointer-events-none">
                    <span className="text-[10px] font-bold tracking-wider text-white uppercase">After</span>
                  </div>
                </div>
                <p className="text-[11px] text-center text-white/50 font-semibold tracking-wide uppercase">Animated Video</p>
              </div>
            </div>
            
            <p className="text-[10px] md:text-xs text-center text-white/40 mt-12 sm:mt-16 max-w-sm mx-auto leading-relaxed">
              *Illustrative AI-generated example. Actual results vary based on source image and selected engine. Not a guarantee of output continuity.
            </p>
          </div>

        </div>
      </div>
    </section>
  );
}
