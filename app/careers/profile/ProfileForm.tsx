"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CareerProfile, Company } from "@/lib/careers";

export default function ProfileForm({ initial }: { initial: CareerProfile }) {
  const [p, setP] = useState(initial);
  const [company, setCompany] = useState<Company>({ name: "", url: "" });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const router = useRouter();
  const set = (patch: Partial<CareerProfile>) => { setP({ ...p, ...patch }); setState("idle"); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("saving");
    const res = await fetch("/api/careers/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    setState(res.ok ? "saved" : "error");
    router.refresh();
  };
  const field = (k: keyof CareerProfile, label: string, placeholder: string, full = false) => (
    <label className={full ? "full" : ""}>{label}
      <input value={String(p[k] ?? "")} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<CareerProfile>)} />
    </label>
  );

  return (
    <form className="card form-grid" onSubmit={save}>
      {field("name", "Your name", "Signs your cover letters")}
      {field("school", "School", "University of Toronto")}
      {field("program", "Program", "Computer Science, Data Science minor")}
      {field("year", "Year / graduation", "3rd year, graduating 2028")}
      {field("location", "Where you live", "Toronto, ON")}
      {field("regions", "Where you'd go", "Canada first; open to Europe and the US")}
      {field("roles", "What you're looking for", "Software, data or ML internship for summer 2027, or a practicum", true)}
      {field("skills", "Skills", "Python, React, SQL, machine learning, public speaking", true)}
      {field("interests", "Interests", "Fintech, healthcare AI, developer tools", true)}
      {field("workAuth", "Work authorization", "Canadian citizen / study permit with co-op work permit", true)}
      <label className="full">Resume or experience <span className="muted">(paste your resume as text: it makes fit scores and letters specific)</span>
        <textarea style={{ minHeight: 200 }} value={p.experience} onChange={(e) => set({ experience: e.target.value })} placeholder="Projects, jobs, clubs, awards…" />
      </label>

      <div className="full">
        <label>Companies the Scout checks every day</label>
        {p.companies.map((c) => (
          <div key={c.name} className="res">
            <span><strong>{c.name}</strong>{c.url && <> · <a href={c.url} target="_blank" rel="noreferrer" className="small">{c.url}</a></>}</span>
            <button type="button" className="link small" onClick={() => set({ companies: p.companies.filter((x) => x.name !== c.name) })}>Remove</button>
          </div>
        ))}
        <div className="add-step">
          <input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} placeholder="Company" />
          <input value={company.url} onChange={(e) => setCompany({ ...company, url: e.target.value })} placeholder="Careers page (optional)" />
          <button type="button" onClick={() => {
            if (!company.name.trim() || p.companies.some((c) => c.name.toLowerCase() === company.name.trim().toLowerCase())) return;
            let url = company.url.trim();
            if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
            set({ companies: [...p.companies, { name: company.name.trim(), url }] });
            setCompany({ name: "", url: "" });
          }}>Add</button>
        </div>
      </div>

      <label className="full check">
        <input type="checkbox" checked={p.conferences} onChange={(e) => set({ conferences: e.target.checked })} />
        Also look for conferences, hackathons, student programs and scholarships
      </label>

      <div className="full">
        <button className="primary" disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save profile"}</button>
        {state === "saved" && <span className="small" style={{ marginLeft: 10 }}>Saved</span>}
        {state === "error" && <span className="small overdue" style={{ marginLeft: 10 }}>Couldn&apos;t save.</span>}
      </div>
    </form>
  );
}
