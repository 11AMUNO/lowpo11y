import type { Metadata } from "next";
import { Container, PageHeader, Prose } from "@/components/site/page-header";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact and takedowns",
  description: "Get in touch, report a problem with a listing or request a takedown.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <Container>
      <PageHeader
        title="Contact and takedowns"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Contact" }]}
        description="Questions, corrections and rights concerns all come to the same place."
      />
      <Prose className="py-10">
        <h2>Get in touch</h2>
        {site.contactEmail ? (
          <p>
            Email <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
          </p>
        ) : (
          <p>A contact address will be published here before launch.</p>
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
    </Container>
  );
}
