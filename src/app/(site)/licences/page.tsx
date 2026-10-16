import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader, Prose } from "@/components/site/page-header";

export const metadata: Metadata = {
  title: "Licences",
  description: "How LOWPO11Y labels licences, what each one lets you do, and how to credit creators.",
  alternates: { canonical: "/licences" },
};

export default function LicencesPage() {
  return (
    <Container>
      <PageHeader
        title="Licences"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Licences" }]}
        description="Every downloadable file carries the licence chosen by its creator. Here is how to read the labels."
      />
      <Prose className="py-10">
        <h2>How licences are shown</h2>
        <p>
          Each asset page shows the licence, whether commercial use and modification are allowed, whether attribution
          is required, and the exact attribution text to use. The same information is included as a{" "}
          <code>LICENSE.txt</code> in every download, and packs list a separate notice for each included asset.
        </p>
        <h2>Common licences</h2>
        <h3>CC0 1.0 (public domain dedication)</h3>
        <p>
          Use for anything, including commercial games, with or without modification. Credit is appreciated but not
          required.
        </p>
        <h3>CC BY 4.0</h3>
        <p>
          Use for anything, including commercially, as long as you credit the creator in the way the asset page
          describes — usually in your game’s credits or documentation.
        </p>
        <h3>CC BY-SA 4.0</h3>
        <p>
          Like CC BY, and adaptations of the asset itself must be shared under the same licence. Check that this suits
          your project before using it.
        </p>
        <h3>Custom licences</h3>
        <p>
          Some creators set their own terms. These are shown in full and never summarised as “free for anything”. Read
          them before use.
        </p>
        <h3>Licence unknown</h3>
        <p>
          If the rights to an item have not been confirmed, it is not published and cannot be downloaded. External
          resources with unclear terms are linked at their source instead of being re-hosted.
        </p>
        <h2>Crediting creators</h2>
        <p>
          When attribution is required, copy the attribution text from the asset page or from <code>LICENSE.txt</code>.
          A good credit names the creator, the asset title, links to the source page and names the licence.
        </p>
        <h2>Problems with a listing</h2>
        <p>
          If you believe an item is listed without permission, use the <Link href="/contact">takedown process</Link>. We
          unpublish disputed items while we check.
        </p>
      </Prose>
    </Container>
  );
}
