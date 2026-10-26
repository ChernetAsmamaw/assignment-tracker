"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Tick or untick this one assignment without leaving its page.
export default function TrackToggle({ id, courseCode, initial, courseOff }: { id: string; courseCode: string; initial: boolean; courseOff: boolean }) {
  const [on, setOn] = useState(initial);
  const [err, setErr] = useState(false);
  const router = useRouter();
  const change = async (next: boolean) => {
    setOn(next);
    setErr(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ include: { assignments: { [id]: next } } }),
    }).catch(() => null);
    if (!res?.ok) {
      setOn(!next);
      setErr(true);
    }
    router.refresh();
  };

  return (
    <div className={`track ${on && !courseOff ? "" : "off"}`}>
      <label>
        <input type="checkbox" className="check" checked={on && !courseOff} disabled={courseOff} onChange={(e) => change(e.target.checked)} />
        <span>
          <strong>Track this assignment</strong>
          <span className="small muted">
            {courseOff ? (
              <>{courseCode} is unticked, so Pace leaves all of it out. <Link href="/courses">Choose courses</Link></>
            ) : on ? (
              "Shows up in your lists, planner, study plans and the morning email."
            ) : (
              "Left out of your lists, planner, study plans and the morning email."
            )}
          </span>
        </span>
      </label>
      {err && <span className="small overdue">Couldn&apos;t save. Try again.</span>}
    </div>
  );
}
