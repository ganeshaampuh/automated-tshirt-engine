/** The string a renderer actually draws for a text layer: `transform: "upper"` is applied before
 *  both measuring and drawing, so fitted sizes match what lands on the canvas. */
export function displayText(l: { text: string; transform?: "none" | "upper" }) {
  return l.transform === "upper" ? l.text.toUpperCase() : l.text;
}
