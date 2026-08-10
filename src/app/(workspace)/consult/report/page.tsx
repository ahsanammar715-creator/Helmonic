export const metadata = { title: "Section 4 draft · Consult · Helmonic" };

const rows = [
  { pos: "P1 · receiving, north", dntw: "47", ctr: "-4", method: "Measured", verdict: "Pass" },
  { pos: "P2 · receiving, centre", dntw: "46", ctr: "-4", method: "Measured", verdict: "Pass" },
  { pos: "P3 · receiving, corner", dntw: "45", ctr: "-5", method: "Measured", verdict: "Pass" },
  { pos: "P4 · receiving, south", dntw: "44", ctr: "-5", method: "Interpolated", verdict: "Review" },
];

export default function ConsultReportPage() {
  return (
    <div className="flex flex-col items-center gap-4 p-6 md:p-10 bg-canvas min-h-full">
      <div className="w-full max-w-[794px] flex items-center justify-between text-[13px] text-muted">
        <span>Section 4 compliance draft · unreviewed</span>
        <button className="border border-line rounded-md px-3 py-1.5 text-sub hover:border-primary hover:text-primary">
          Download PDF
        </button>
      </div>
      <div className="w-full max-w-[794px] bg-surface border border-line rounded-md p-6 flex flex-col gap-4.5 text-ink text-[11px] leading-[1.55]">
        <div className="flex items-start justify-between gap-5 border-b-2 border-primary pb-3">
          <div className="flex flex-col gap-1">
            <span className="font-bold text-[17px] tracking-tight">
              Airborne sound insulation assessment
            </span>
            <span className="text-muted">
              Harrow Property Group · Level 3 boardroom · project HPG-0431
            </span>
          </div>
          <div className="text-right flex flex-col gap-1">
            <span className="font-bold text-[12px]">iAcoustics</span>
            <span className="text-faint text-[10px]">Draft · rev A</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-bold text-[13px]">4 Assessment</span>
          <span className="font-semibold text-sub">4.1 Scope and criteria</span>
          <p className="m-0 text-sub">
            Field measurements of airborne sound insulation were carried out between the level 3
            boardroom and the adjoining open-plan office. The client criterion is D<sub>nT,w</sub>{" "}
            ≥ 45 dB. Measurements followed ISO 16283-1:2014, with the low-frequency procedure of
            clause 6.2 applied in the boardroom because its volume is below 25 m³.
          </p>
          <span className="font-semibold text-sub pt-1">4.2 Results</span>
          <table className="w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="bg-canvas">
                {["POSITION", "DnT,w", "Ctr", "METHOD", "CRITERION"].map((h) => (
                  <th
                    key={h}
                    className="text-left py-1.5 border-b border-line font-semibold text-[10px] tracking-[0.05em] text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pos}>
                  <td className="py-1.5 border-b border-line-soft">{r.pos}</td>
                  <td className="py-1.5 border-b border-line-soft text-sub">{r.dntw}</td>
                  <td className="py-1.5 border-b border-line-soft text-sub">{r.ctr}</td>
                  <td className="py-1.5 border-b border-line-soft text-sub">{r.method}</td>
                  <td
                    className={`py-1.5 border-b border-line-soft font-semibold ${
                      r.verdict === "Pass" ? "text-success" : "text-warning"
                    }`}
                  >
                    {r.verdict}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 text-sub">
            Positions P1 to P3 meet the criterion. P4 was interpolated from the adjacent positions
            because the receiving-room export was incomplete; the value is reported for
            information only and is flagged in section 4.4 for re-measurement.
          </p>
          <span className="font-semibold text-sub pt-1">4.3 Discussion</span>
          <p className="m-0 text-sub">
            The measured performance is governed by the glazed section of the dividing partition
            rather than by the stud wall. Flanking via the raised floor was checked and found not
            to be significant. The partition as built therefore satisfies the client brief across
            the occupied area of the boardroom.
          </p>
          <span className="font-semibold text-sub pt-1">4.4 Outstanding items</span>
          <div className="border border-line rounded-md bg-canvas p-3.5 flex flex-col gap-1.5">
            <span className="flex gap-2 text-sub">
              <span className="text-warning font-semibold">1.</span>
              Re-measure P4 with a complete receiving-room export before the report is issued.
            </span>
            <span className="flex gap-2 text-sub">
              <span className="text-warning font-semibold">2.</span>
              Confirm the glazing specification against the supplier certificate (Rw 42 assumed).
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="font-semibold text-[10px] tracking-[0.06em] text-faint">
            SOURCES CITED
          </span>
          <div className="flex flex-col gap-1 text-muted text-[10px]">
            <span>ISO 16283-1:2014 · clause 6.2 · low-frequency procedure</span>
            <span>AS/NZS 2107:2016 · Table 1 · p. 11 · design sound levels</span>
            <span>L3-boardroom-airborne.rew · L3-boardroom-bands.csv · client brief</span>
          </div>
          <div className="flex items-center justify-between text-faint text-[10px] pt-1">
            <span>Drafted by Helmonic · every figure traceable to a source · unreviewed</span>
            <span>Page 4 of 9</span>
          </div>
        </div>
      </div>
    </div>
  );
}
