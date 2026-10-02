import { NextRequest, NextResponse } from "next/server";
import { montarEstadoAtualizacao } from "@/lib/extensao";

/**
 * Informa à extensão qual é a versão publicada e o que mudou desde a versão
 * instalada — é o que alimenta o "🔄 Verificar atualização" no popup.
 *
 * GET /api/extensao/versao?instalada=1.3.0
 */
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function GET(req: NextRequest) {
  try {
    const instalada = req.nextUrl.searchParams.get("instalada");
    return NextResponse.json(montarEstadoAtualizacao(instalada), { headers: CORS });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}
