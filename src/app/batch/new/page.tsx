import Link from "next/link";
import { MAX_MEMBERS, MAX_SETS } from "@/lib/csv";
import { SHIRT_COLORS } from "@/lib/shirtColors";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

const COLUMNS: { name: string; required: boolean; note: string }[] = [
  { name: "kid_name", required: true, note: "Nama anak yang ulang tahun." },
  { name: "age", required: true, note: "Umur dalam angka bulat, 0-120." },
  { name: "theme", required: true, note: "Tema desain, misal “unicorn pastel”." },
  { name: "members", required: true, note: "Daftar “Nama:ukuran” dipisah titik koma. Ukuran: adult, kids-0-1, kids-1-9, atau kid untuk si anak ulang tahun (tepat satu)." },
  { name: "language", required: false, note: "id atau en. Kosong berarti id." },
  { name: "shirt_color", required: false, note: `Kode heks (#ffffff) atau nama warna: ${SHIRT_COLORS.map(c => c.name.toLowerCase()).join(", ")}.` },
  { name: "clipart_url", required: false, note: "URL https atau data:image. Kosong berarti gambar dibuat otomatis." },
];

export default function NewBatchPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-14">
      <header className="mb-8">
        <Link href="/" className="font-display text-[13px] text-muted transition-colors hover:text-ink">
          ← Kembali
        </Link>
        <h1 className="mt-3 font-display text-[26px] leading-tight font-medium">Batch dari CSV</h1>
        <p className="mt-1 text-[14px] text-muted">
          Unggah satu file CSV, periksa dulu, lalu buat batch. Maksimal {MAX_SETS} set dan {MAX_MEMBERS} kaos per file.
        </p>
      </header>

      <UploadForm />

      <section className="mt-10 border-t border-rule pt-6">
        <h2 className="font-display text-[14px] font-medium">Kolom yang dibaca</h2>
        <p className="mt-1 text-[13px] text-muted">
          Baris pertama adalah nama kolom. Urutannya bebas, kolom lain diabaikan.
        </p>
        <dl className="mt-4 space-y-3">
          {COLUMNS.map(col => (
            <div key={col.name} className="grid gap-1 sm:grid-cols-[160px_1fr] sm:gap-3">
              <dt className="font-mono text-[12px] text-ink">
                {col.name}
                {col.required && <span className="ml-1 text-[11px] text-alert">wajib</span>}
              </dt>
              <dd className="text-[13px] text-muted">{col.note}</dd>
            </div>
          ))}
        </dl>
        <pre className="mt-4 overflow-x-auto border border-rule bg-panel px-3 py-2 font-mono text-[12px] leading-relaxed text-muted">
{`kid_name,age,theme,members,language,shirt_color
Keisya,5,unicorn pastel,Ayah:adult;Mama:adult;Keisya:kid,id,#ffffff
Bima,1,dinosaurus,"Ayah:adult;Bunda:adult;Bima:kid",id,navy`}
        </pre>
      </section>
    </div>
  );
}
