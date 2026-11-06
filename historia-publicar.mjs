// Publica una imagen (JPG con URL pública) como historia en @hermestarot444 y muestra la bio y los seguidores.
// Corre en GitHub Actions (workflow "historia" con publicar=si). Secretos: HT_PAGE_TOKEN, HT_IG_USER_ID.
// Uso: node historia-publicar.mjs https://github.com/matiasosuna/hermes-media/releases/download/videos/historia-x.jpg
const env = process.env, V = 'v21.0';
const image_url = process.argv[2];
if (!image_url) throw new Error('falta la URL de la imagen');
if (!env.HT_PAGE_TOKEN || !env.HT_IG_USER_ID) throw new Error('faltan HT_PAGE_TOKEN / HT_IG_USER_ID');
const g = async (m, ruta, q = {}) => {
  const j = await (await fetch(`https://graph.facebook.com/${V}${ruta}?${new URLSearchParams({ ...q, access_token: env.HT_PAGE_TOKEN })}`, { method: m })).json();
  if (j.error) throw new Error(`${ruta}: ${j.error.message}`);
  return j;
};
const IG = env.HT_IG_USER_ID;
const { id } = await g('POST', `/${IG}/media`, { media_type: 'STORIES', image_url });
for (let i = 0; i < 30; i++) {
  const { status_code } = await g('GET', `/${id}`, { fields: 'status_code' });
  if (status_code === 'FINISHED') break;
  if (status_code === 'ERROR') throw new Error('Instagram no pudo procesar la imagen');
  await new Promise((r) => setTimeout(r, 3000));
}
const pub = await g('POST', `/${IG}/media_publish`, { creation_id: id });
console.log('historia publicada:', pub.id);
const perfil = await g('GET', `/${IG}`, { fields: 'biography,followers_count' });
console.log('seguidores:', perfil.followers_count);
console.log('bio:\n' + perfil.biography);
