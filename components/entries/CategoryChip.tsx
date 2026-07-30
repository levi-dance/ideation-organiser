import { categoryStyle } from "@/lib/design/category-style";

export default function CategoryChip({ slug, name }: { slug: string; name: string }) {
  const style = categoryStyle(slug, name);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: style.wash, color: style.deep }}
    >
      <style.Icon size={11} strokeWidth={2.4} />
      {name}
    </span>
  );
}
