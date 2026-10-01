import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>ShieldLabs with the Next.js App Router</h1>
      <p>
        The signup form starts an identification when you first interact with it and sends the request
        ID with the submit. A Server Action reads the verdict from the History API and applies a policy,
        and the route handler at <code>/api/shieldlabs/webhook</code> receives signed webhooks.
      </p>
      <p>
        <Link href="/signup">Open the signup form</Link>
      </p>
    </main>
  );
}
