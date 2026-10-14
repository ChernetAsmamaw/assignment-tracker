export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 360, margin: "15vh auto 0" }}>
      <h2>Assignment Tracker</h2>
      <form method="post" action="/api/login">
        <label htmlFor="pw">Password</label>
        <input id="pw" name="password" type="password" autoFocus required />
        {error && <p className="small overdue">Wrong password.</p>}
        <button className="primary" style={{ marginTop: 12, width: "100%" }}>Sign in</button>
      </form>
    </div>
  );
}
