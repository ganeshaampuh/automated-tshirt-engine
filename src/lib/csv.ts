import { SetInputSchema, type Member, type SetInput, type SizeClass, type Language } from "@/engine";
import { SHIRT_COLORS } from "@/lib/shirtColors";

export type ParsedRow = { line: number; input: SetInput };
/** Human-facing message, always Indonesian, always naming the offending field. */
export type RowError = { line: number; message: string };
export type ParseResult = { rows: ParsedRow[]; errors: RowError[] };

/** Caps a single upload: enough for a reseller's day, small enough to render without falling over. */
export const MAX_SETS = 200;
export const MAX_MEMBERS = 1000;

const REQUIRED_COLUMNS = ["kid_name", "age", "theme", "members"] as const;
const SIZE_CLASSES: SizeClass[] = ["adult", "kids-0-1", "kids-1-9"];
const HEX = /^#[0-9a-fA-F]{6}$/;

type Record_ = { fields: string[]; line: number };

/**
 * RFC4180 scanner: honours quoted fields (so a `members` cell may contain commas), the `""`
 * escape, both CRLF and LF, and a trailing blank line. Written as a character scanner rather
 * than a `split` for exactly that reason.
 */
function scan(text: string): Record_[] {
  const out: Record_[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const endField = () => { fields.push(field); field = ""; };
  const endRecord = () => {
    endField();
    // A record that is a single empty field is a blank line, not a row.
    if (!(fields.length === 1 && fields[0] === "")) out.push({ fields, line: recordLine });
    fields = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!started) { recordLine = line; started = true; }
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") { quoted = true; continue; }
    if (c === ",") { endField(); continue; }
    if (c === "\r" && text[i + 1] === "\n") { i++; line++; endRecord(); continue; }
    if (c === "\n") { line++; endRecord(); continue; }
    if (c === "\r") { line++; endRecord(); continue; }
    field += c;
  }
  if (started || field !== "" || fields.length > 0) endRecord();
  return out;
}

export function parseCsv(text: string): string[][] {
  return scan(text).map(r => r.fields);
}

/**
 * `Label:sizeClass` tokens separated by `;`. The token `kid` in place of a size class marks the
 * birthday child, whose class comes from the age instead. Throws an Indonesian message.
 */
export function parseMembers(spec: string, age: number): Member[] {
  const tokens = spec.split(";").map(t => t.trim()).filter(t => t !== "");
  if (tokens.length === 0) throw new Error("Kolom members kosong, tulis minimal satu anggota.");

  const members: Member[] = [];
  tokens.forEach((token, i) => {
    const at = token.lastIndexOf(":");
    if (at <= 0 || at === token.length - 1) {
      throw new Error(`Anggota "${token}" tidak memakai format "Nama:ukuran".`);
    }
    const label = token.slice(0, at).trim();
    const size = token.slice(at + 1).trim().toLowerCase();
    if (label === "") throw new Error(`Anggota "${token}" tidak punya nama.`);
    const isKid = size === "kid";
    if (!isKid && !SIZE_CLASSES.includes(size as SizeClass)) {
      throw new Error(`Ukuran "${size}" pada anggota "${label}" tidak dikenal, pakai ${SIZE_CLASSES.join(", ")} atau kid.`);
    }
    members.push({
      id: `m-${i + 1}`,
      kind: isKid ? "birthday-kid" : "family",
      label,
      sizeClass: isKid ? kidSizeClass(age) : (size as SizeClass),
    });
  });

  const kids = members.filter(m => m.kind === "birthday-kid").length;
  if (kids !== 1) {
    throw new Error(`Kolom members harus berisi tepat satu anak ulang tahun (tandai dengan ":kid"), ditemukan ${kids}.`);
  }
  return members;
}

function kidSizeClass(age: number): SizeClass {
  if (age <= 1) return "kids-0-1";
  if (age <= 9) return "kids-1-9";
  return "adult";
}

function resolveShirtColor(raw: string): string {
  const value = raw.trim();
  if (value === "") return "#ffffff";
  if (HEX.test(value)) return value.toLowerCase();
  const hit = SHIRT_COLORS.find(c => c.name.toLowerCase() === value.toLowerCase());
  if (hit) return hit.hex;
  throw new Error(
    `Kolom shirt_color "${value}" tidak dikenal, pakai kode heks (#ffffff) atau ${SHIRT_COLORS.map(c => c.name.toLowerCase()).join(", ")}.`,
  );
}

function buildInput(get: (col: string) => string): SetInput {
  const kidName = get("kid_name").trim();
  if (kidName === "") throw new Error("Kolom kid_name wajib diisi.");

  const ageRaw = get("age").trim();
  const age = Number(ageRaw);
  if (ageRaw === "" || !Number.isInteger(age) || age < 0 || age > 120) {
    throw new Error(`Kolom age "${ageRaw}" bukan umur yang valid (angka bulat 0-120).`);
  }

  const theme = get("theme").trim();
  if (theme === "") throw new Error("Kolom theme wajib diisi.");

  const members = parseMembers(get("members"), age);

  const langRaw = get("language").trim().toLowerCase();
  if (langRaw !== "" && langRaw !== "id" && langRaw !== "en") {
    throw new Error(`Kolom language "${langRaw}" tidak dikenal, pakai id atau en.`);
  }
  const language: Language = langRaw === "en" ? "en" : "id";

  const clipart = get("clipart_url").trim();
  // Deliberately narrower than `ClipartSrc` in `@/engine`: that schema also allows the asset paths
  // this app ships (`tests/fixtures/`, `public/`, `/samples/`, ...) because its own code names them.
  // A CSV is operator input, so it may name only a remote https image or an inline data: image —
  // it must never be able to point a set at a path inside the repo. Do not replace this check with
  // `SetInputSchema` validation alone; that would silently reopen those paths.
  if (clipart !== "" && !clipart.startsWith("https://") && !clipart.startsWith("data:image/")) {
    throw new Error(`Kolom clipart_url harus berupa URL https atau data:image, bukan "${clipart}".`);
  }

  const input: SetInput = {
    kidName,
    age,
    theme,
    shirtColor: resolveShirtColor(get("shirt_color")),
    language,
    members,
    ...(clipart === "" ? {} : { clipartSrc: clipart }),
  };

  const parsed = SetInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? `kolom ${issue.path.join(".")}` : "baris ini";
    throw new Error(`Data tidak valid pada ${where}: ${issue.message}`);
  }
  return parsed.data;
}

/**
 * Total validation: a row either yields a `ParsedRow` or a `RowError`, never both, so a caller
 * can create a batch only when `errors` is empty and never leaves half a batch behind.
 */
export function parseBatchRows(text: string): ParseResult {
  if (text.trim() === "") return { rows: [], errors: [{ line: 1, message: "File CSV kosong." }] };

  const records = scan(text);
  if (records.length === 0) return { rows: [], errors: [{ line: 1, message: "File CSV kosong." }] };

  const header = records[0].fields.map(h => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter(c => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [{ line: 1, message: `Kolom wajib tidak ditemukan: ${missing.join(", ")}.` }] };
  }

  const body = records.slice(1);
  if (body.length === 0) {
    return { rows: [], errors: [{ line: 1, message: "Tidak ada baris data setelah header." }] };
  }
  if (body.length > MAX_SETS) {
    return {
      rows: [],
      errors: [{ line: 1, message: `File berisi ${body.length} baris, maksimal ${MAX_SETS} set per batch.` }],
    };
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  let memberCount = 0;

  for (const record of body) {
    const get = (col: string) => {
      const at = header.indexOf(col);
      return at === -1 ? "" : (record.fields[at] ?? "");
    };
    try {
      const input = buildInput(get);
      memberCount += input.members.length;
      if (memberCount > MAX_MEMBERS) {
        errors.push({ line: record.line, message: `Total anggota melebihi batas ${MAX_MEMBERS} per batch.` });
        break;
      }
      rows.push({ line: record.line, input });
    } catch (e) {
      errors.push({ line: record.line, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return { rows, errors };
}
