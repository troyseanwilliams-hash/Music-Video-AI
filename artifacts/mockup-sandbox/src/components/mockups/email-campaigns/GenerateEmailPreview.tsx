export function GenerateEmailPreview() {
  return (
    <div className="email-preview">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #0b0a11; }
        .email-preview {
          min-height: 100vh;
          padding: 34px 18px 60px;
          background:
            radial-gradient(circle at 50% 0%, rgba(96, 53, 182, .22), transparent 30%),
            #0b0a11;
          color: #f7f4ff;
          font-family: 'DM Sans', Arial, sans-serif;
        }
        .mail-shell { max-width: 640px; margin: 0 auto; }
        .subject-line {
          display: flex; justify-content: space-between; gap: 12px;
          color: #928da3; font-size: 11px; letter-spacing: .04em;
          margin: 0 auto 12px; max-width: 620px; padding: 0 8px;
        }
        .subject-line strong { color: #c6bfd4; font-weight: 500; }
        .email-card {
          overflow: hidden; border: 1px solid #282238; border-radius: 18px;
          background: #12101a; box-shadow: 0 24px 70px rgba(0,0,0,.38);
        }
        .header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 30px; border-bottom: 1px solid rgba(255,255,255,.08);
          background: rgba(17, 15, 25, .92);
        }
        .brand { display: flex; align-items: center; gap: 9px; font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px; }
        .brand-mark {
          display: grid; place-items: center; width: 27px; height: 27px; border-radius: 8px;
          background: linear-gradient(135deg, #9d37ff, #397eff); box-shadow: 0 0 20px rgba(133, 67, 255, .45);
          font-size: 14px;
        }
        .header-link { color: #aaa2bb; font-size: 12px; text-decoration: none; }
        .hero {
          position: relative; overflow: hidden; padding: 54px 46px 48px;
          background:
            radial-gradient(circle at 10% 0%, rgba(151, 54, 255, .48), transparent 42%),
            radial-gradient(circle at 94% 30%, rgba(33, 122, 255, .36), transparent 45%),
            linear-gradient(145deg, #1b1230, #101e42 78%);
        }
        .hero:after {
          content: ''; position: absolute; width: 250px; height: 250px; right: -90px; bottom: -130px;
          border-radius: 50%; border: 1px solid rgba(143, 129, 255, .3); box-shadow: 0 0 0 18px rgba(143,129,255,.04), 0 0 0 38px rgba(143,129,255,.025);
        }
        .eyebrow {
          display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border-radius: 99px;
          color: #d9b9ff; border: 1px solid rgba(203, 143, 255, .38); background: rgba(65, 24, 114, .42);
          font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
        }
        h1, h2, h3, p { margin: 0; }
        .hero h1 { max-width: 500px; position: relative; z-index: 1; margin-top: 22px; font-family: 'Space Grotesk', sans-serif; font-size: clamp(34px, 7vw, 52px); line-height: .99; letter-spacing: -.055em; }
        .gradient-text { background: linear-gradient(100deg, #c35aff 15%, #658aff 78%); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .hero-copy { position: relative; z-index: 1; max-width: 490px; margin-top: 20px; color: #d5cce2; font-size: 16px; line-height: 1.55; }
        .cta-row { position: relative; z-index: 1; display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-top: 29px; }
        .button {
          display: inline-flex; align-items: center; justify-content: center; padding: 13px 19px; border-radius: 9px;
          background: linear-gradient(105deg, #a735ff, #387fff); color: white; font-size: 13px; font-weight: 700; text-decoration: none;
          box-shadow: 0 10px 25px rgba(103, 46, 255, .28);
        }
        .text-link { color: #d5c0ff; font-size: 13px; text-decoration: none; font-weight: 600; }
        .hero-note { color: #a99fba; font-size: 11px; margin-top: 17px; }
        .video-card { position: relative; z-index: 1; margin-top: 38px; border: 1px solid rgba(210, 191, 255, .23); border-radius: 13px; overflow: hidden; background: #161522; }
        .video-art { height: 190px; position: relative; display: flex; align-items: flex-end; padding: 18px; background: linear-gradient(135deg, rgba(126, 28, 174, .75), rgba(10, 32, 80, .92)), repeating-linear-gradient(115deg, transparent 0 38px, rgba(255,255,255,.035) 39px 40px); }
        .video-art:before, .video-art:after { content: ''; position: absolute; border-radius: 50%; filter: blur(1px); }
        .video-art:before { width: 190px; height: 190px; top: -75px; left: 65px; background: rgba(246, 90, 216, .38); }
        .video-art:after { width: 270px; height: 270px; right: -95px; bottom: -160px; background: rgba(42, 153, 255, .42); }
        .video-title { position: relative; z-index: 1; font-family: 'Space Grotesk', sans-serif; font-size: 21px; font-weight: 600; letter-spacing: -.03em; }
        .play { position: absolute; z-index: 2; inset: 0; margin: auto; width: 52px; height: 52px; display: grid; place-items: center; border-radius: 50%; background: rgba(10, 8, 19, .62); border: 1px solid rgba(255,255,255,.55); font-size: 19px; padding-left: 3px; }
        .video-meta { display: flex; justify-content: space-between; padding: 11px 14px; color: #a8a2b5; font-size: 11px; }
        .section { padding: 39px 46px 2px; }
        .section-label { color: #b889ff; font-size: 11px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
        .section h2 { margin-top: 10px; font-family: 'Space Grotesk', sans-serif; font-size: 28px; line-height: 1.08; letter-spacing: -.045em; }
        .section-intro { margin-top: 13px; color: #aaa3b6; font-size: 14px; line-height: 1.6; }
        .product-shot { margin: 25px 0 6px; border: 1px solid #342b4e; border-radius: 12px; overflow: hidden; background: #0d0c12; box-shadow: 0 16px 30px rgba(0,0,0,.22); }
        .product-shot img { display: block; width: 100%; height: auto; }
        .caption { padding: 11px 14px 13px; color: #8f879e; font-size: 11px; line-height: 1.45; background: #17131f; }
        .feature-grid { display: grid; gap: 0; margin-top: 28px; border-top: 1px solid #2a2336; }
        .feature { display: grid; grid-template-columns: 32px 1fr; gap: 15px; padding: 24px 0; border-bottom: 1px solid #2a2336; }
        .feature-num { color: #9560ec; font-family: 'Space Grotesk', sans-serif; font-size: 12px; font-weight: 700; padding-top: 3px; }
        .feature h3 { font-family: 'Space Grotesk', sans-serif; font-size: 17px; letter-spacing: -.02em; }
        .feature p { margin-top: 6px; color: #a9a1b2; font-size: 13px; line-height: 1.56; }
        .approval-callout { margin: 34px 0 6px; padding: 22px 23px; border: 1px solid #5b3e96; border-radius: 12px; background: linear-gradient(135deg, rgba(87, 41, 138, .38), rgba(39, 67, 134, .22)); }
        .approval-callout h3 { font-family: 'Space Grotesk', sans-serif; font-size: 19px; }
        .approval-callout p { margin-top: 8px; color: #c3b8d2; font-size: 13px; line-height: 1.55; }
        .approval-callout strong { color: #f2eaff; }
        .final-cta { margin: 42px 46px 47px; padding: 30px 25px; text-align: center; border-radius: 13px; background: linear-gradient(135deg, #201235, #142a51); border: 1px solid #3b376b; }
        .final-cta h2 { font-family: 'Space Grotesk', sans-serif; font-size: 26px; line-height: 1.1; letter-spacing: -.04em; }
        .final-cta p { max-width: 410px; margin: 11px auto 19px; color: #bdb2cc; font-size: 13px; line-height: 1.55; }
        .footer { padding: 24px 30px 29px; border-top: 1px solid #292331; text-align: center; color: #797282; font-size: 10px; line-height: 1.6; }
        .footer-brand { color: #b9b0c6; font-family: 'Space Grotesk', sans-serif; font-weight: 700; margin-bottom: 7px; }
        .footer a { color: #9d83c7; text-decoration: underline; }
        @media (max-width: 560px) {
          .email-preview { padding: 12px 8px 35px; }
          .subject-line { display: block; line-height: 1.6; padding: 0 4px 8px; }
          .header { padding: 17px 20px; }
          .hero, .section { padding-left: 24px; padding-right: 24px; }
          .hero { padding-top: 38px; padding-bottom: 34px; }
          .hero h1 { font-size: 39px; }
          .final-cta { margin-left: 24px; margin-right: 24px; }
          .video-art { height: 165px; }
        }
      `}</style>

      <div className="mail-shell">
        <div className="subject-line">
          <span><strong>Subject:</strong> Build the story before you render.</span>
          <span>Preview email</span>
        </div>

        <article className="email-card">
          <header className="header">
            <div className="brand"><span className="brand-mark">▣</span> AIBeatSync</div>
            <a className="header-link" href="#generate">Open Generate Video&nbsp; →</a>
          </header>

          <section className="hero">
            <div className="eyebrow">✦ New in AIBeatSync</div>
            <h1>Build the story <span className="gradient-text">before you render.</span></h1>
            <p className="hero-copy">
              Meet the new Generate Video experience: scene-by-scene direction, stronger character continuity, and image approvals before animation begins.
            </p>
            <div className="cta-row">
              <a className="button" href="#generate">Generate a Video&nbsp; →</a>
              <a className="text-link" href="#watch">Watch the example&nbsp; ↗</a>
            </div>
            <p className="hero-note">Your visual direction stays in your hands from the first scene to the final frame.</p>

            <div className="video-card" id="watch">
              <div className="video-art">
                <div className="play">▶</div>
                <div className="video-title">From one idea to a complete visual story</div>
              </div>
              <div className="video-meta"><span>AIBeatSync · Generate Video</span><span>Watch preview ↗</span></div>
            </div>
          </section>

          <section className="section">
            <div className="section-label">A better way to direct</div>
            <h2>See the whole visual story before you spend time rendering it.</h2>
            <p className="section-intro">
              Generate Video turns your concept into a connected sequence of scenes. Every image has a purpose, every moment moves the story forward, and you get to review the direction before the final video is made.
            </p>

            <div className="product-shot">
              <img src="/__mockup/images/generate-storyboard.png" alt="Scene reference storyboard showing chronological scene directions and generated image previews" />
              <div className="caption">Scene direction, reference images, and storyboard progress—together in one review.</div>
            </div>

            <div className="feature-grid">
              <div className="feature">
                <div className="feature-num">01</div>
                <div><h3>Generate every scene with intention</h3><p>Start with one idea and get a chronological visual plan with unique descriptions for each moment, including mood, framing, lighting, and composition.</p></div>
              </div>
              <div className="feature">
                <div className="feature-num">02</div>
                <div><h3>Keep your character recognizable</h3><p>Optional Character Reference helps guide a recurring character through changing scenes, camera angles, locations, and moments.</p></div>
              </div>
              <div className="feature">
                <div className="feature-num">03</div>
                <div><h3>Preview and approve every image</h3><p>Review the complete image sequence before animation. Approve the direction only when every scene feels right.</p></div>
              </div>
              <div className="feature">
                <div className="feature-num">04</div>
                <div><h3>Regenerate only what needs work</h3><p>Change a scene description and regenerate that image while keeping the rest of your visual sequence intact.</p></div>
              </div>
            </div>

            <div className="approval-callout">
              <h3>Approve first. Animate second.</h3>
              <p><strong>You stay in control before video generation begins.</strong> Once your images are approved, Generate Video brings the complete sequence to life as a finished music video.</p>
            </div>
          </section>

          <section className="final-cta" id="generate">
            <h2>Your music deserves a visual story.</h2>
            <p>Shape every scene, keep your characters consistent, and make the final call before your video renders.</p>
            <a className="button" href="#generate">Try Generate Video&nbsp; →</a>
          </section>

          <footer className="footer">
            <div className="footer-brand">AIBeatSync</div>
            Create connected music videos with more creative control.<br />
            <a href="#preferences">Manage email preferences</a>&nbsp; · &nbsp;<a href="#unsubscribe">Unsubscribe</a>
          </footer>
        </article>
      </div>
    </div>
  );
}