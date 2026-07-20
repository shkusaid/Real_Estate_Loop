import { NextResponse } from "next/server";
import { dummyProperties } from "@/data/dummyData";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") || "").toLowerCase();

  if (!query) {
    return NextResponse.json(dummyProperties);
  }

  const results = dummyProperties.filter((property) => {
    return (
      property.title.toLowerCase().includes(query) ||
      property.type.toLowerCase().includes(query) ||
      property.city.toLowerCase().includes(query) ||
      property.location.toLowerCase().includes(query) ||
      property.description.toLowerCase().includes(query) ||
      property.bedrooms.toString().includes(query) ||
      property.bathrooms.toString().includes(query) ||
      property.price.toString().includes(query)
    );
  });

  return NextResponse.json(results);
}