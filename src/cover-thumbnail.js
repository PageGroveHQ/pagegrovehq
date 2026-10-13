// Small shelf artwork travels with metadata; original ebook images stay local.
export async function coverThumbnail(source) {
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(source || "")) return null;
  if (source.length <= 120000) return source;
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), 5000);
    image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.onload = () => {
      clearTimeout(timer);
      try {
        const scale = Math.min(1, 240 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        const thumbnail = canvas.toDataURL("image/jpeg", 0.75);
        resolve(thumbnail.length <= 120000 ? thumbnail : null);
      } catch { resolve(null); }
    };
    image.src = source;
  });
}
