// Click-to-load video: YouTube's player (and its requests) only load once the visitor asks for it,
// from the privacy-enhanced youtube-nocookie.com domain.
document.getElementById('play').addEventListener('click', (e) => {
  const frame = document.createElement('iframe');
  frame.src = 'https://www.youtube-nocookie.com/embed/OSSHAtk5siA?autoplay=1&rel=0';
  frame.title = 'Botless for YouTube: demo';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  e.currentTarget.replaceWith(frame);
});
