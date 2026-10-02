import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deixa o node-postgres fora do bundle do servidor (evita problemas de
  // empacotamento de módulos nativos/opcionais na Vercel).
  serverExternalPackages: ["pg"],
};

export default nextConfig;
