import { Hero } from "@/components/Hero";
import { PropertySearch } from "@/components/PropertySearch";
import { NextAddress } from "@/components/NextAddress";
import { TransformationSection } from "@/components/TransformationSection";
import { PropertyCollection } from "@/components/PropertyCollection";
import { AboutSection } from "@/components/AboutSection";
import { PropertyMap } from "@/components/PropertyMap";
import { FeaturedProperty } from "@/components/FeaturedProperty";
import { FinalCTA } from "@/components/FinalCTA";

export default function HomePage() {
  return (
    <>
      <Hero />
      <PropertySearch />
      <NextAddress />
      <TransformationSection />
      <PropertyCollection />
      <AboutSection />
      <PropertyMap />
      <FeaturedProperty />
      <FinalCTA />
    </>
  );
}
