import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildTaxonomy,
  BuildValidationError,
  type PlannedCategory,
  type PlannedDestination,
} from "@/lib/setup/build-taxonomy";

// Creating a category page and a database per destination is a Notion call
// each, and the build finishes with a full sync.
export const maxDuration = 300;

function parsePlan(raw: unknown[]): PlannedCategory[] {
  return raw.map((item, i) => {
    const c = item as Record<string, unknown>;
    const str = (value: unknown) => (typeof value === "string" ? value : "");
    const destinations = Array.isArray(c.destinations) ? c.destinations : [];
    return {
      key: str(c.key) || `category-${i + 1}`,
      name: str(c.name).trim(),
      description: str(c.description).trim(),
      parentKey: str(c.parentKey).trim(),
      isCatchAll: c.isCatchAll === true,
      destinations: destinations.map((d): PlannedDestination => {
        const dest = d as Record<string, unknown>;
        return {
          title: str(dest.title).trim(),
          kind: dest.kind === "document_section" ? "document_section" : "bank_database",
          sectionHeading: str(dest.sectionHeading).trim(),
          dedupEnabled: dest.dedupEnabled === true,
        };
      }),
    };
  });
}

/**
 * Create the confirmed structure in Notion, mirror it into the taxonomy, and
 * reconcile. Refuses when a taxonomy already exists (see assertBuildable).
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.categories)) {
    return NextResponse.json({ error: "categories must be an array" }, { status: 400 });
  }

  try {
    const report = await buildTaxonomy(parsePlan(body.categories as unknown[]));
    return NextResponse.json(report);
  } catch (e) {
    if (e instanceof BuildValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    // buildTaxonomy trashes anything it created before rethrowing, so trying
    // again is safe. Notion's trash holds the discarded pages for 30 days.
    return NextResponse.json(
      {
        error: `${e instanceof Error ? e.message : "Build failed"}. Nothing was kept, so you can fix the problem and build again.`,
      },
      { status: 500 }
    );
  }
}
