/** @type {import('next').NextConfig} */
const nextConfig = {
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },

  // ✅ Disable ESLint blocking during production builds (Docker/CI)
  eslint: {
    ignoreDuringBuilds: true,
  },
  
  async redirects() {
    return [
      {
      source: "/", // root URL
      destination: "/welcome",
      permanent: false,
    },
      {
        source: "/dashboard",
        destination: "/grade/university",
        permanent: false,
      },
    ];
  },
}

export default nextConfig
