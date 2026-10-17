import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader, Prose } from "@/components/site/page-header";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What LOWPO11Y stores, what it never collects, and how browser tools handle your files.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <Container>
      <PageHeader
        title="Privacy"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Privacy" }]}
        description="Short version: we do not need to know who you are, and files you open in the tools never leave your browser."
      />
      <Prose className="py-10">
        <h2>Files you open in tools</h2>
        <p>
          The texture, palette, atlas, font, decal and model tools, the Workshop and the Scene Builder process files
          entirely in your browser. Your images, fonts, models and scenes are not uploaded, stored on our servers or
          included in analytics. Library models and textures you place in the Scene Builder are downloaded the same way
          as from their pages, so they count as downloads (see below). If a future feature ever needs to send a file to a server, it will say so before you use it and
          will be off by default.
        </p>
        <h2>What is stored on your device</h2>
        <ul>
          <li>Your theme choice and tool settings, in your browser’s local storage.</li>
          <li>Workshop recipes you save and the pipeline you were last working on, in your browser’s local storage, until you delete them. Workshop images only if you turn on “Keep images on this device”; turning it off deletes them.</li>
          <li>The scene you are editing in the Scene Builder, in local storage, so it can be recovered after a refresh or crash. Models and images you add from your computer are kept in the browser’s IndexedDB storage so a recovered scene can find them; “Forget kept files” in the Local tab deletes them.</li>
          <li>Staff sign-in uses one essential session cookie. Visitors do not need to sign in.</li>
        </ul>
        <h2>What the server records</h2>
        <ul>
          <li>
            A download count per file, used to rank popular assets. Counts are stored without IP addresses or any
            identifier linking them to you.
          </li>
          <li>
            Standard request logs kept by our hosting provider for security and troubleshooting, retained for a short
            period.
          </li>
          <li>Messages you send through the contact form, kept only as long as needed to respond.</li>
        </ul>
        <h2>What we do not do</h2>
        <ul>
          <li>No advertising or cross-site tracking cookies.</li>
          <li>No selling or sharing of personal data.</li>
          <li>
            Embedded YouTube videos load only when you choose to play them, using YouTube’s privacy-enhanced mode.
          </li>
        </ul>
        <h2>Questions or requests</h2>
        <p>
          To ask what we hold about you or to request deletion, <Link href="/contact">contact us</Link>.
        </p>
      </Prose>
    </Container>
  );
}
