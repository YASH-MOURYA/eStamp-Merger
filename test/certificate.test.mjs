import assert from "node:assert/strict";
import { A4, HEADER, layoutCertificates, textWidth } from "../src/lib/merge.js";

const MAX = A4.width - HEADER.marginRight - HEADER.marginLeft;
const num = (i) => `IN-KA${String(60205095895692 + i * 1111111111).padStart(14, "0")}Q`; // 19 characters, like the real ones

// 1) one, three: single line, exactly "Certificate Number: n1,n2,n3"
for (const n of [1, 3]) {
  const numbers = Array.from({ length: n }, (_, i) => num(i));
  const { lines, size } = layoutCertificates(numbers);
  assert.equal(lines.length, 1);
  assert.equal(size, 12);
  assert.equal(lines.join(""), `Certificate Number: ${numbers.join(",")}`);
}

// 2) many: line is full -> next number starts on a NEW line below; nothing is ever split
for (const n of [4, 5, 10, 25]) {
  const numbers = Array.from({ length: n }, (_, i) => num(i));
  const { lines, size } = layoutCertificates(numbers);
  assert.ok(lines.length > 1, `${n} numbers should need more than one line`);
  assert.equal(size, 12, "font size must not change just because of wrapping");
  assert.equal(lines.join(""), `Certificate Number: ${numbers.join(",")}`, "no character lost, added or reordered");
  for (const line of lines) assert.ok(textWidth(line, size) <= MAX + 0.01, "every line fits the page width");
  // each line = whole numbers only: strip the label, split on commas, each piece must be a complete number
  const pieces = lines.join("").replace("Certificate Number: ", "").split(",");
  assert.deepEqual(pieces, numbers, "every certificate number is complete");
  // a line may only end right after a comma (or be the last line) - never in the middle of a number
  lines.slice(0, -1).forEach((line) => assert.ok(line.endsWith(","), `line must end after a comma: "${line}"`));
  // and the next line must start with a whole number (or the label on the first line)
  lines.slice(1).forEach((line) => assert.match(line, /^IN-KA\d{14}Q/, `line must start with a complete number: "${line}"`));
}

// 3) absurdly long single number: shrink the font, still never cut
{
  const huge = "IN-" + "X".repeat(120);
  const { lines, size } = layoutCertificates([huge, num(1)]);
  assert.ok(size < 12, "font shrinks when one number alone is wider than the page");
  assert.equal(lines.join(""), `Certificate Number: ${huge},${num(1)}`);
  for (const line of lines) assert.ok(textWidth(line, size) <= MAX + 0.01);
}

// 4) single certificate sits where the real application puts it (starts ~310 pt, ends at the right margin)
{
  const { lines, size } = layoutCertificates(["IN-DL89959002014420Y"]);
  const start = A4.width - HEADER.marginRight - textWidth(lines[0], size);
  assert.ok(Math.abs(start - 310) < 3, `single certificate should start near x=310, got ${start.toFixed(1)}`);
}
console.log("certificate layout tests passed");
