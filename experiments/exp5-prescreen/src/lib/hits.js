// src/lib/hits.js
export const subjectHitOf = (r) => {
  if (typeof r.subject_hit === 'number') return r.subject_hit;
  if (typeof r.matched === 'number') return r.matched;
  if (
    typeof r.selected_index === 'number' &&
    typeof r.target_index_0based === 'number'
  ) {
    return Number(r.selected_index === r.target_index_0based);
  }
  return null;
};

export const demonHitOf = (r) => {
  if (typeof r.demon_hit === 'number') return r.demon_hit;
  if (
    typeof r.selected_index === 'number' &&
    typeof r.ghost_index_0based === 'number'
  ) {
    return Number(r.selected_index === r.ghost_index_0based);
  }
  return null;
};
