import type { Metadata } from "next";
import { Container, PageHeader, Prose } from "@/components/site/page-header";

export const metadata: Metadata = {
  title: "About",
  description: "What LOWPO11Y is, who it is for and the principles behind it.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <Container>
      <PageHeader
        title="About LOWPO11Y"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "About" }]}
        description="A free library and toolkit for people making low-poly and retro-styled games."
      />
      <Prose className="py-10">
        <p>
          LOWPO11Y collects low-poly models, tileable textures, engine shaders and starter projects in one place, with
          the browser tools you need to adapt them: resizing, palette reduction, dithering, seamless tiling, atlas
          packing, bitmap fonts and model inspection. It is built for hobbyists making PS1-inspired horror, Blender
          artists optimising assets, game-jam teams who need something usable today, and anyone chasing a PS2 or
          N64-era look.
        </p>
        <h2>Principles</h2>
        <ul>
          <li>
            <strong>Free to browse and download.</strong> No account, no download wall, no countdown timers.
          </li>
          <li>
            <strong>Licences are shown, never assumed.</strong> Every asset lists its licence and attribution. Assets
            without a confirmed licence are not published.
          </li>
          <li>
            <strong>Your files stay yours.</strong> Tools process files in your browser. Nothing you open in a tool
            is uploaded.
          </li>
          <li>
            <strong>Honest about history.</strong> We separate documented console behaviour from modern stylised
            interpretations. A “PSX-inspired” preset is a look, not an emulation of real hardware limits.
          </li>
          <li>
            <strong>Every button does what it says.</strong> Features that are not finished are labelled as in
            development rather than shown as dead links.
          </li>
        </ul>
        <h2>Demo content</h2>
        <p>
          Items marked <em>demo</em> are generated procedurally by LOWPO11Y so the site can be tested before the main
          library is imported. They are released under CC0 and you are welcome to use them.
        </p>
        <h2>Trademarks</h2>
        <p>
          PlayStation, Nintendo 64, Godot, Blender, Unity and Unreal are trademarks of their respective owners and are
          mentioned only to describe compatibility or visual style. LOWPO11Y is not affiliated with any of them.
        </p>
      </Prose>
    </Container>
  );
}
