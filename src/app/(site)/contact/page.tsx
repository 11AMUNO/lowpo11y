import type { Metadata } from "next";
import { Container, PageHeader, Prose } from "@/components/site/page-header";
import { Panel } from "@/components/ui/panel";
import { ContactForm } from "@/features/contact/contact-form";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact and takedowns",
  description: "Get in touch, report a problem with a listing or request a takedown.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const sp = await searchParams;
  const topic = typeof sp.topic === "string" ? sp.topic : "general";
  const asset = typeof sp.asset === "string" && /^[a-z0-9-]{1,80}$/.test(sp.asset) ? sp.asset : null;
  return (
    <Container>
      <PageHeader
        title="Contact and takedowns"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Contact" }]}
        description="Questions, corrections and rights concerns all come to the same place."
      />
      <div className="grid items-start gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Panel title="Send a message">
          <ContactForm initialKind={topic} initialPath={asset ? `/assets/${asset}` : ""} />
        </Panel>
      <Prose>
        <h2>Other ways</h2>
        {site.contactEmail ? (
          <p>
            Email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
          </p>
        ) : (
          <p>Use the form; messages go straight to the people who run the library.</p>
        )}
        <h2>Takedown requests</h2>
        <p>If you hold rights in an item listed on LOWPO11Y and did not permit its use, include:</p>
        <ol>
          <li>The page address of the item.</li>
          <li>Who you are and your relationship to the work.</li>
          <li>Evidence of ownership, such as an original source link or project file.</li>
          <li>What you would like to happen: removal, corrected credit, or a licence change.</li>
        </ol>
        <p>
          We unpublish disputed items while we check, usually within two working days, and keep a record of the
          decision. Unpublished items stop being downloadable immediately.
        </p>
      </Prose>
      </div>
    </Container>
  );
}
