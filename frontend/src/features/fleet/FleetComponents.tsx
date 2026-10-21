import React from "react";

export function Status({ value }: { value: string }) {
  return (
    <span className={`fleet-status fleet-status-${value}`}>
      <i />
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Table({
  headings,
  children,
}: {
  headings: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="fleet-table-scroll">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="fleet-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
