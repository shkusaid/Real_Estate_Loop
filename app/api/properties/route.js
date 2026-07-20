import { NextResponse } from "next/server";
import { dummyProperties } from "@/data/dummyData";

export async function GET() {
  return NextResponse.json(dummyProperties);
}