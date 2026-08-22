import { describe, expect, it, vi } from "vitest";
import { readExistingBackup } from "../src/backup-directory";

describe("détection d'une sauvegarde dans un dossier choisi", () => {
  it("lit le fichier existant sans l'écrire", async () => {
    const getFileHandle = vi.fn().mockResolvedValue({
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue('{"schemaVersion":2}'),
      }),
    });
    const handle = { getFileHandle } as unknown as FileSystemDirectoryHandle;

    await expect(readExistingBackup(handle)).resolves.toBe('{"schemaVersion":2}');
    expect(getFileHandle).toHaveBeenCalledWith("companion-backup.json");
  });

  it("retourne null lorsque le dossier ne contient pas encore de backup", async () => {
    const handle = {
      getFileHandle: vi.fn().mockRejectedValue(new DOMException("Absent", "NotFoundError")),
    } as unknown as FileSystemDirectoryHandle;

    await expect(readExistingBackup(handle)).resolves.toBeNull();
  });
});
