import { Arimo, Tinos } from "next/font/google";

// Metric-compatible stand-ins for Arial (printed text) and Times New Roman (field
// text), used only where those fonts are not installed so line lengths still match.
export const formSans = Arimo({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-dd-sans",
});

export const formSerif = Tinos({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-dd-serif",
});
