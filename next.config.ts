import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone: a self-contained server plus only the traced
  // node_modules it actually needs. That is what makes the runtime stage of the
  // Dockerfile a copy rather than an `npm install`, and it is why the image does
  // not ship the toolchain that built it.
  output: "standalone",
  // Pinned so Turbopack does not walk up and adopt a stray lockfile in the
  // home directory as the workspace root.
  turbopack: { root: __dirname },
  images: {
    // Artwork is served straight from the metadata provider's CDN. Only the
    // hosts we actually import from are allowed — `remotePatterns` is an
    // allow-list, and widening it would let any URL in the database become an
    // image-optimiser fetch.
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org", pathname: "/t/p/**" },
    ],
  },
};

export default nextConfig;
