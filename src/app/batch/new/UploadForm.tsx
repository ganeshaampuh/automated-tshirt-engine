"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createBatchFromCsvAction, validateCsvAction } from "@/app/actions/batches";
import { Button, ToastHost, useAction, useToast } from "@/app/components/ui";
import type { RowError } from "@/lib/csv";
import { MAX_CSV_MESSAGE, MAX_UPLOAD_BYTES } from "@/lib/upload";

type Report = { rows: number; members: number; errors: RowError[] };

function Panel() {
  const router = useRouter();
  const { show } = useToast();
  const { pending, run } = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  // A new file invalidates the report: "Buat batch" must never act on a check of the previous file.
  function pick(next: File | null) {
    setReport(null);
    if (next && next.size > MAX_UPLOAD_BYTES) {
      show(MAX_CSV_MESSAGE);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(next);
  }

  function body(): FormData {
    const form = new FormData();
    if (file) form.set("file", file);
    return form;
  }

  const check = () =>
    run("check", async () => {
      const result = await validateCsvAction(body());
      if (result.ok) setReport(result.data);
      return result;
    });

  const create = () =>
    run("create", async () => {
      const result = await createBatchFromCsvAction(body());
      if (result.ok) router.push(`/batch/${result.data.id}`);
      return result;
    });

  const ready = report !== null && report.errors.length === 0 && report.rows > 0;

  return (
    <div className="border border-rule bg-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-4">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          data-testid="csv-input"
          onChange={e => pick(e.target.files?.[0] ?? null)}
          className="max-w-full text-[13px] text-muted file:mr-3 file:rounded-[var(--radius-ctl)] file:border file:border-rule file:bg-bench file:px-2.5 file:py-1.5 file:font-display file:text-[13px] file:text-ink"
        />
        <div className="ml-auto flex gap-2">
          <Button onClick={check} disabled={!file} pending={pending === "check"} data-testid="check">
            Periksa
          </Button>
          <Button
            variant="primary"
            onClick={create}
            disabled={!ready}
            pending={pending === "create"}
            data-testid="create"
          >
            Buat batch
          </Button>
        </div>
      </div>

      {report === null ? (
        <p className="px-4 py-6 text-[13px] text-muted">
          Pilih file CSV lalu tekan “Periksa”. Batch baru dibuat setelah semua baris bersih.
        </p>
      ) : (
        <div className="px-4 py-4">
          <p data-testid="report-counts" className="font-display text-[15px]">
            {report.rows} set, {report.members} kaos
          </p>
          {report.errors.length === 0 ? (
            <p className="mt-1 text-[13px] text-muted">Tidak ada masalah. Silakan buat batch.</p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-alert">
                {report.errors.length} baris bermasalah. Perbaiki di file CSV lalu periksa lagi.
              </p>
              <table data-testid="report-errors" className="mt-3 w-full border-t border-rule text-left">
                <thead>
                  <tr className="text-[12px] text-muted">
                    <th scope="col" className="w-[72px] py-2 font-display font-medium">Baris</th>
                    <th scope="col" className="py-2 font-display font-medium">Masalah</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map(e => (
                    <tr key={`${e.line}-${e.message}`} className="border-t border-rule align-top">
                      <td className="py-2 font-mono text-[12px] tabular-nums">{e.line}</td>
                      <td className="py-2 text-[13px]">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function UploadForm() {
  return (
    <ToastHost>
      <Panel />
    </ToastHost>
  );
}
