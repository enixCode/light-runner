[**light-runner v0.10.0**](../index.md)

***

[light-runner](../index.md) / RunState

# Interface: RunState

Defined in: [src/state.ts:8](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L8)

## Properties

### cancelled?

```ts
optional cancelled?: boolean;
```

Defined in: [src/state.ts:27](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L27)

***

### command?

```ts
optional command?: string;
```

Defined in: [src/state.ts:14](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L14)

***

### container

```ts
container: string;
```

Defined in: [src/state.ts:10](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L10)

***

### durationMs?

```ts
optional durationMs?: number;
```

Defined in: [src/state.ts:21](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L21)

***

### exitCode?

```ts
optional exitCode?: number;
```

Defined in: [src/state.ts:20](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L20)

***

### extract?

```ts
optional extract?: ExtractSpec[];
```

Defined in: [src/state.ts:16](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L16)

***

### finishedAt?

```ts
optional finishedAt?: string;
```

Defined in: [src/state.ts:18](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L18)

***

### id

```ts
id: string;
```

Defined in: [src/state.ts:9](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L9)

***

### image

```ts
image: string;
```

Defined in: [src/state.ts:12](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L12)

***

### startedAt

```ts
startedAt: string;
```

Defined in: [src/state.ts:17](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L17)

***

### status

```ts
status: "running" | "exited" | "cancelled" | "failed";
```

Defined in: [src/state.ts:19](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L19)

***

### timeout?

```ts
optional timeout?: number;
```

Defined in: [src/state.ts:15](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L15)

***

### volume

```ts
volume: string;
```

Defined in: [src/state.ts:11](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L11)

***

### workdir

```ts
workdir: string;
```

Defined in: [src/state.ts:13](https://github.com/enixCode/light-runner/blob/1d600653d4731c2d3f44bd5a293b40da3c37d55c/src/state.ts#L13)
