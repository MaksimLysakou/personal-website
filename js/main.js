const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const menuToggle = document.querySelector(".menu-toggle");
const menu = document.querySelector("#nav-menu");
function closeMenu() {
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation");
  menu.classList.remove("is-open");
}
menuToggle.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
  menu.classList.toggle("is-open", open);
});
menu
  .querySelectorAll("a")
  .forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.classList.contains("is-open")) {
    closeMenu();
    menuToggle.focus();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".nav")) closeMenu();
});
const mobileViewport = window.matchMedia("(max-width: 600px)");
mobileViewport.addEventListener("change", closeMenu);

if ("IntersectionObserver" in window && !reducedMotion.matches) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 },
  );
  document.querySelectorAll(".reveal").forEach((element) => {
    element.classList.add("reveal-pending");
    revealObserver.observe(element);
  });
}

const testimonials = Array.from(
  document.querySelectorAll("[data-testimonial]"),
);
const content = document.querySelector("#testimonials-content");
let activeTestimonial = 0;
function showTestimonial(index) {
  activeTestimonial = (index + testimonials.length) % testimonials.length;
  testimonials.forEach((testimonial, i) => {
    testimonial.hidden = i !== activeTestimonial;
  });
  document.querySelector("#testimonial-index").textContent = String(
    activeTestimonial + 1,
  ).padStart(2, "0");
}
content.classList.add("carousel-active");
content.setAttribute("aria-live", "polite");
content.setAttribute("aria-atomic", "true");
document.querySelector(".testimonial-controls").hidden = false;
document
  .querySelector("#previous-testimonial")
  .addEventListener("click", () => showTestimonial(activeTestimonial - 1));
document
  .querySelector("#next-testimonial")
  .addEventListener("click", () => showTestimonial(activeTestimonial + 1));
showTestimonial(0);

// Keep the page functional even if WebGL or the optional scene cannot load.
let heroRequested = false;
function loadHero() {
  if (mobileViewport.matches || heroRequested) return;
  heroRequested = true;
  import("./hero.js")
    .then(({ initHero }) => {
      if (mobileViewport.matches) {
        heroRequested = false;
        return;
      }
      initHero(reducedMotion);
    })
    .catch(() => {
      heroRequested = false;
    });
}
mobileViewport.addEventListener("change", loadHero);
loadHero();
