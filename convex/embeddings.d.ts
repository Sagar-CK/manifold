export declare const embed: import("convex/server").RegisteredAction<"public", {
    input: {
        kind: "text";
        text: string;
    } | {
        kind: "inlineData";
        mimeType: string;
        base64Data: string;
    };
}, Promise<number[]>>;
