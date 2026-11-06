// Catégorie d'une pièce d'après son type, comme getCategory() dans index.html
// (filtre « Catégorie » de la boutique). Sert aux alertes « nouvelles pièces ».
function categoryOf(type) {
  const t = String(type || '').toLowerCase();
  const R = [
    ['Écharpes', /étole|etole|foulard|écharpe|echarpe|chèche|cheche|tour de cou/],
    ['Accessoires', /breloque|ceinture|cravate|gants?\b|moufle|bracelet|boucles|bague|collier|broche|pendentif|bijou|chaussette/],
    ['Sacs', /\bsacs?\b|banane|satchel|cabas|pochette|portefeuille|cartable|sacoche|maroquinerie/],
    ['Chapeaux', /chapeau|bonnet|panama|casquette|\bcap\b|béret|beret/],
    ['Chaussures', /botte|boots|basket|trainer|ballerine|escarpin|mocassin|derbies|derby|sandale|chaussure|sneaker|espadrille|\btongs?\b|\bmules?\b|lace.?ups?/],
    ['Costumes', /costume|tailleur/],
    ['Combinaisons', /combinaison|jumpsuit|salopette/],
    ['Robes', /robe|tunique|tunic/],
    ['Jupes', /jupe/],
    ['Pantalons', /pantalon|\bjeans?\b|short|bermuda|legging|sarouel|harem/],
    ['Manteaux', /manteau|parka|caban|duffle|trench|puffer|doudoune/],
    ['Vestes', /veste|blouson|blazer/],
    ['Chemises', /chemis|blouse/],
    ['Pulls & gilets', /pull|gilet|cardigan|jumper|maille/],
    ['Sweats', /sweat/],
    ['T-shirts & tops', /t-shirt|\btee\b|débardeur|debardeur|polo|\bhaut\b|\btop\b|camisole/],
  ];
  for (const [c, re] of R) if (re.test(t)) return c;
  return 'Autres';
}
const CAT_ORDER = ['Vestes', 'Manteaux', 'Costumes', 'Chemises', 'T-shirts & tops', 'Pulls & gilets', 'Sweats', 'Pantalons', 'Jupes', 'Robes', 'Combinaisons', 'Chaussures', 'Sacs', 'Chapeaux', 'Écharpes', 'Accessoires', 'Autres'];
const CAT_EN = { 'Vestes': 'Jackets', 'Manteaux': 'Coats', 'Costumes': 'Suits', 'Chemises': 'Shirts', 'T-shirts & tops': 'T-shirts & tops', 'Pulls & gilets': 'Knitwear', 'Sweats': 'Sweatshirts', 'Pantalons': 'Trousers', 'Jupes': 'Skirts', 'Robes': 'Dresses', 'Combinaisons': 'Jumpsuits', 'Chaussures': 'Shoes', 'Sacs': 'Bags', 'Chapeaux': 'Hats', 'Écharpes': 'Scarves', 'Accessoires': 'Accessories', 'Autres': 'Other', 'Bas': 'Bottoms', 'Hauts': 'Tops', 'Maille': 'Knitwear' };
module.exports = { categoryOf, CAT_EN, CAT_ORDER };
