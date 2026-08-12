import type { IpcMain } from "electron";
import type { SttTranscribeRequest, SttTranscribeResponse } from "./transcriptionContract";

/**
 * Registers the stable STT IPC surface without loading whisper model discovery,
 * chunking and process-management code during ordinary application startup.
 * The first transcription/cancel request imports the implementation and the
 * implementation itself continues to own the single manager instance.
 */
export function registerLazySttIpc(ipcMain: IpcMain): void {
	ipcMain.handle(
		"stt:transcribe",
		async (event, req: SttTranscribeRequest): Promise<SttTranscribeResponse> => {
			const { getSttManager } = await import("./index");
			const manager = getSttManager();
			const senderId = event.sender.id;
			const detach = manager.addStatusSink((statusEvent) => {
				if (event.sender.id === senderId && !event.sender.isDestroyed()) {
					event.sender.send("stt:status", statusEvent);
				}
			});
			try {
				return await manager.transcribe(req);
			} finally {
				detach();
			}
		},
	);
	ipcMain.handle("stt:cancel", async () => {
		const { getSttManager } = await import("./index");
		getSttManager().cancel();
	});
}
