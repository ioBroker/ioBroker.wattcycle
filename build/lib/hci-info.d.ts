export interface HciInfo {
    devId: number;
    address: string;
    name: string;
}
export declare function readHciInfos(timeoutMs?: number): Promise<HciInfo[]>;
