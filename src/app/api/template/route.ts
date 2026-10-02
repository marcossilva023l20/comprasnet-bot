import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export async function GET() {
  const data = [
    {
      "Item": 1,
      "Descrição": "AQUECEDOR DE ÁGUA ELÉTRICO",
      "Descrição Detalhada": "material: corpo plástico, tensão: 220V, potência: 5.500W, 3 temperaturas",
      "Quantidade": 20,
      "Unidade": "Unidade",
      "Valor Estimado (R$)": 337.47,
      "Valor Unitário (R$)": 299.90,
      "Marca/Fabricante": "LORENZETTI",
      "Modelo/Versão": "ADVANCED TURBO",
    },
    {
      "Item": 2,
      "Descrição": "RESISTÊNCIA ELÉTRICA",
      "Descrição Detalhada": "",
      "Quantidade": 30,
      "Unidade": "Unidade",
      "Valor Estimado (R$)": 34.04,
      "Valor Unitário (R$)": 28.50,
      "Marca/Fabricante": "LORENZETTI",
      "Modelo/Versão": "3056-A",
    },
    {
      "Item": 3,
      "Descrição": "CHUVEIRO NÃO ELÉTRICO",
      "Descrição Detalhada": "",
      "Quantidade": 80,
      "Unidade": "Unidade",
      "Valor Estimado (R$)": 9.79,
      "Valor Unitário (R$)": "",
      "Marca/Fabricante": "",
      "Modelo/Versão": "",
    },
  ];

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [6, 35, 50, 12, 12, 18, 18, 25, 25].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Modelo Proposta");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo_proposta_comprasnet.xlsx"',
    },
  });
}
