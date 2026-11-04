// Catégorie d'une pièce d'après son type, comme getCategory() dans index.html
// (filtre « Catégorie » de la boutique). Sert aux alertes « nouvelles pièces ».
function categoryOf(type) {
  const t = String(type || '').toLowerCase();
  const has = (...w) => w.some(x => t.includes(x));
  if (has('sac', 'banane', 'étole', 'foulard', 'echarpe', 'écharpe', 'cheche', 'chèche', 'chapeau', 'bonnet', 'ceinture', 'portefeuille', 'maroquinerie', 'cartable')) return 'Accessoires';
  if (has('bottes', 'basket', 'ballerine', 'escarpin', 'mocassin', 'derby', 'sandale')) return 'Chaussures';
  if (has('robe', 'tunique')) return 'Robes';
  if (has('pantalon', 'jean', 'jupe', 'short', 'bermuda', 'legging')) return 'Bas';
  if (has('veste', 'blouson', 'manteau', 'parka', 'blazer')) return 'Vestes';
  if (has('sweat', 'pull', 'cardigan', 'gilet')) return 'Maille';
  if (has('chemise', 'top', 'tee', 't-shirt', 'blouse', 'polo', 'débardeur', 'debardeur', 'haut')) return 'Hauts';
  return 'Autres';
}
const CAT_EN = { Accessoires: 'Accessories', Chaussures: 'Shoes', Robes: 'Dresses', Bas: 'Bottoms', Vestes: 'Jackets', Maille: 'Knitwear', Hauts: 'Tops', Autres: 'Other' };
module.exports = { categoryOf, CAT_EN };
