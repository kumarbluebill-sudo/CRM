export type RazorpayCtor = new (options: Record<string, unknown>) => { open(): void };
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

/** Loads Razorpay Checkout in the browser on demand. Only checkout.razorpay.com is allowed by our CSP. */
export function loadCheckout(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://checkout.razorpay.com/v1/checkout.js";
    el.async = true;
    el.onload = () =>
      window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Checkout unavailable"));
    el.onerror = () => reject(new Error("Checkout unavailable"));
    document.head.appendChild(el);
  });
}
