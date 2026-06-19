export const BRAND_REGISTRY_COLLECTION = "BrandRegistry"

const normalizeText = (value) => String(value || "").trim().toLowerCase()
const normalizeLooseText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\//g, " ")
    .replace(/^\s*\d+\.\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const looseMatch = (candidate, filter) => {
  const c = normalizeLooseText(candidate)
  const f = normalizeLooseText(filter)
  if (!f) return true
  if (!c) return false
  return c === f || c.includes(f) || f.includes(c)
}

const uniqueSorted = (values) =>
  [...new Set(values.filter(Boolean))]
    .map((v) => String(v).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))

const getLegacyCategories = (doc) => {
  if (Array.isArray(doc?.categories) && doc.categories.length > 0) return doc.categories
  if (doc?.category) return [doc.category]
  return []
}

const getSystemsForCategory = (doc, category) => {
  const fromMap = doc?.systemsByCategory?.[category]
  if (Array.isArray(fromMap)) return fromMap
  if (Array.isArray(doc?.systems)) return doc.systems
  if (doc?.system) return [doc.system]
  return []
}

const getSubSystemsForCategorySystem = (doc, category, system) => {
  const fromMap = doc?.subSystemsByCategory?.[category]?.[system]
  if (Array.isArray(fromMap)) return fromMap
  const legacy = doc?.subSystems?.[system]
  if (Array.isArray(legacy)) return legacy
  return []
}

const getSubSubSystemsForCategorySystemSubSystem = (doc, category, system, subSystem) => {
  const fromMap = doc?.subSubSystemsByCategory?.[category]?.[system]?.[subSystem]
  if (Array.isArray(fromMap)) return fromMap
  const legacy = doc?.subSubSystems?.[system]?.[subSystem]
  if (Array.isArray(legacy)) return legacy
  return []
}

const matchPath = (doc, filters) => {
  const categoryFilter = normalizeText(filters?.category)
  const systemFilter = normalizeText(filters?.system)
  const subSystemFilter = normalizeText(filters?.subsystem)
  const subSubSystemFilter = normalizeText(filters?.subsubsystem)

  const categories = getLegacyCategories(doc)
  const categoryCandidates = categoryFilter
    ? categories.filter((c) => looseMatch(c, categoryFilter))
    : categories

  if (categories.length > 0 && categoryCandidates.length === 0) return false

  // If no category exists in the document (legacy case), still try matching system-only.
  const effectiveCategories = categoryCandidates.length > 0 ? categoryCandidates : [""]

  for (const category of effectiveCategories) {
    const systems = getSystemsForCategory(doc, category)
    const systemCandidates = systemFilter
      ? systems.filter((s) => looseMatch(s, systemFilter))
      : systems

    if (systemFilter && systems.length > 0 && systemCandidates.length === 0) continue
    if (systemFilter && systems.length === 0) continue

    const effectiveSystems = systemCandidates.length > 0 ? systemCandidates : [""]

    for (const system of effectiveSystems) {
      const subSystems = getSubSystemsForCategorySystem(doc, category, system)
      const subSystemCandidates = subSystemFilter
        ? subSystems.filter((s) => looseMatch(s, subSystemFilter))
        : subSystems

      if (subSystemFilter && subSystems.length > 0 && subSystemCandidates.length === 0) continue
      if (subSystemFilter && subSystems.length === 0) continue

      const effectiveSubSystems = subSystemCandidates.length > 0 ? subSystemCandidates : [""]

      for (const subSystem of effectiveSubSystems) {
        const subSubSystems = getSubSubSystemsForCategorySystemSubSystem(doc, category, system, subSystem)
        if (subSubSystemFilter) {
          if (subSubSystems.length === 0) continue
          const hasSubSubSystem = subSubSystems.some(
            (s) => looseMatch(s, subSubSystemFilter),
          )
          if (!hasSubSubSystem) continue
        }
        return true
      }
    }
  }
  return !categoryFilter && !systemFilter && !subSystemFilter && !subSubSystemFilter
}

export const getBrandOptionsFromRegistry = (brandDocs, filters = {}) => {
  if (!Array.isArray(brandDocs)) return []
  const values = brandDocs
    .filter((row) => String(row?.brandName || "").trim() !== "")
    .filter((row) => matchPath(row, filters))
    .map((row) => row.brandName)
  return uniqueSorted(values)
}

export const getItemTypeOptionsFromRegistry = (brandDocs, filters = {}) => {
  if (!Array.isArray(brandDocs)) return []

  const categoryFilter = filters?.category
  const systemFilter = filters?.system
  const brandFilter = normalizeText(filters?.brand)
  const itemTypes = []

  brandDocs
    .filter((row) => String(row?.brandName || "").trim() !== "")
    .filter((row) => (brandFilter ? normalizeText(row.brandName) === brandFilter : true))
    .forEach((row) => {
      const categories = getLegacyCategories(row)
      const matchingCategories = categoryFilter
        ? categories.filter((c) => looseMatch(c, categoryFilter))
        : categories
      const effectiveCategories = matchingCategories.length > 0 ? matchingCategories : [""]

      effectiveCategories.forEach((category) => {
        const systems = getSystemsForCategory(row, category)
        const matchingSystems = systemFilter
          ? systems.filter((s) => looseMatch(s, systemFilter))
          : systems
        const effectiveSystems = matchingSystems.length > 0 ? matchingSystems : [""]

        effectiveSystems.forEach((system) => {
          const subSystems = getSubSystemsForCategorySystem(row, category, system)
          itemTypes.push(...subSystems)

          subSystems.forEach((subSystem) => {
            const subSubSystems = getSubSubSystemsForCategorySystemSubSystem(
              row,
              category,
              system,
              subSystem,
            )
            itemTypes.push(...subSubSystems)
          })
        })
      })
    })

  return uniqueSorted(itemTypes)
}

export const loadBrandRegistry = async (db, getDocs, collection) => {
  const snap = await getDocs(collection(db, BRAND_REGISTRY_COLLECTION))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
