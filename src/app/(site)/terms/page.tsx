import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader, Prose } from "@/components/site/page-header";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "Terms for using the LOWPO11Y website, tools and downloads.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <Container>
      <PageHeader
        title="Terms of use"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Terms" }]}
        description="Plain-language terms for the website, the browser tools and the files you download."
      />
      <Prose className="py-10">
        <h2>Downloads</h2>
        <p>
          Each downloadable file is provided under the licence shown on its page and in its <code>LICENSE.txt</code>.
          That licence, not these terms, decides how you may use the file. See <Link href="/licences">Licences</Link>.
        </p>
        <h2>Browser tools</h2>
        <p>
          You keep all rights to files you process with the tools. Output is yours to use, subject to the rights you
          hold in the input. The tools are provided as they are, without guarantees that output will suit any
          particular engine or purpose; check results in your own pipeline.
        </p>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not attempt to access admin areas or other people’s data.</li>
          <li>Do not scrape the library in bulk in ways that degrade the service for others.</li>
          <li>Do not re-host the library as a competing download site.</li>
        </ul>
        <h2>No warranty</h2>
        <p>
          The site is offered free of charge and without warranty. To the extent the law allows, LOWPO11Y is not
          liable for losses arising from use of the site, tools or downloads.
        </p>
        <h2>Changes</h2>
        <p>These terms may be updated. The current version is always published on this page.</p>
      </Prose>
    </Container>
  );
}
