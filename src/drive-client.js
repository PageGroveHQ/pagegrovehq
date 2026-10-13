// Tokens stay in memory. All private Drive requests bypass browser HTTP caching.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SUPPORTED_BOOK = /\.(epub|pdf|fb2|txt|md|html?)$/i;
const fields =
  "id,name,mimeType,size,modifiedTime,md5Checksum,trashed,parents,capabilities(canDownload)";
export function folderId(value) {
  const text = String(value || "").trim();
  const match = text.match(
    /^https:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/)([\w-]+)/,
  );
  const id = match?.[1] || text;
  if (!/^[\w-]{1,200}$/.test(id))
    throw new Error("Paste a Google Drive folder link or folder ID.");
  return id;
}
export function cleanDriveFolder(value) {
  if (!value?.id || !/^[\w-]{1,200}$/.test(value.id)) return null;
  return {
    id: value.id,
    name: String(value.name || "Books").slice(0, 200),
    recursive: !!value.recursive,
    enabled: !!value.enabled,
  };
}
export function createDriveClient(token, request = fetch) {
  async function get(path, params = {}, binary = false, signal) {
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    const response = await request(url.href, {
      headers: { Authorization: `Bearer ${token()}` },
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      if (response.status === 401)
        throw new Error(
          "Drive access expired. Reconnect Google Drive in Account & sync.",
        );
      if (response.status === 403)
        throw new Error(
          "Drive access was denied. Grant read-only Drive access and enable the Drive API for Page Grove. " +
            (detail.error?.message || ""),
        );
      if (response.status === 404)
        throw new Error(
          "This Drive file or folder is no longer available to your account.",
        );
      throw new Error(
        detail.error?.message ||
          `Drive request failed (${response.status}). Try again later.`,
      );
    }
    return binary ? response : response.json();
  }
  return {
    file: (id, signal) =>
      get(
        `files/${encodeURIComponent(id)}`,
        { fields, supportsAllDrives: "true" },
        false,
        signal,
      ),
    async folders(parent = "root", signal) {
      return this.children(
        parent,
        " and mimeType = 'application/vnd.google-apps.folder'",
        signal,
      );
    },
    async children(parent, filter = "", signal) {
      if (parent !== "root") folderId(parent);
      const files = [];
      let next = "";
      do {
        const result = await get(
          "files",
          {
            q: `'${parent}' in parents and trashed = false${filter}`,
            fields: `nextPageToken,incompleteSearch,files(${fields})`,
            pageSize: "1000",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
            ...(next ? { pageToken: next } : {}),
          },
          false,
          signal,
        );
        if (result.incompleteSearch)
          throw new Error(
            "Drive returned an incomplete folder listing. Try again before changing your library.",
          );
        files.push(...(result.files || []));
        next = result.nextPageToken || "";
      } while (next);
      return files;
    },
    async scan(id, recursive = false, signal) {
      const root = await this.file(folderId(id), signal);
      if (root.trashed || root.mimeType !== FOLDER_MIME)
        throw new Error("Choose an available Google Drive folder.");
      const queue = [id],
        visited = new Set(),
        books = [];
      while (queue.length) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        if (visited.size > 2000)
          throw new Error(
            "This library has more than 2,000 folders. Choose a smaller folder.",
          );
        const children = await this.children(current, "", signal);
        for (const file of children) {
          if (recursive && file.mimeType === FOLDER_MIME) queue.push(file.id);
          else if (
            SUPPORTED_BOOK.test(file.name) &&
            file.mimeType !== FOLDER_MIME
          )
            books.push(file);
        }
        if (books.length > 10000)
          throw new Error("Choose a folder with fewer than 10,000 books.");
      }
      return { folder: root, files: books };
    },
    async download(file, signal) {
      if (Number(file.size) > 100 * 1024 * 1024)
        throw new Error("This book exceeds Page Grove’s 100 MB file limit.");
      if (file.capabilities?.canDownload === false)
        throw new Error(
          "The Drive owner does not allow downloading this book.",
        );
      const response = await get(
        `files/${encodeURIComponent(file.id)}`,
        { alt: "media", supportsAllDrives: "true" },
        true,
        signal,
      );
      const reader = response.body?.getReader();
      if (!reader) {
        const blob = await response.blob();
        if (blob.size > 100 * 1024 * 1024)
          throw new Error("This book exceeds the 100 MB file limit.");
        return new File([blob], file.name, { type: blob.type });
      }
      let size = 0;
      const parts = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 100 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("This book exceeds the 100 MB file limit.");
        }
        parts.push(value);
      }
      return new File(parts, file.name, {
        type:
          response.headers.get("content-type") || "application/octet-stream",
      });
    },
  };
}
