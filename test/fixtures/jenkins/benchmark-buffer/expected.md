<details>
<summary>Benchmark results</summary>

```
                                                                    confidence improvement accuracy (*)   (**)   (***)
 buffers/buffer-creation.js n=1024 len=1024 type='buffer()'                        -0.00 %       ±4.52% ±6.02%  ±7.84%
 buffers/buffer-creation.js n=1024 len=1024 type='fast-alloc'                      -3.99 %       ±5.65% ±7.53%  ±9.83%
 buffers/buffer-creation.js n=1024 len=1024 type='fast-alloc-fill'                 -2.66 %       ±3.69% ±4.92%  ±6.41%
 buffers/buffer-creation.js n=1024 len=1024 type='fast-allocUnsafe'                -5.03 %       ±5.27% ±7.02%  ±9.13%
 buffers/buffer-creation.js n=1024 len=1024 type='slow'                            -0.93 %       ±5.41% ±7.21%  ±9.42%
 buffers/buffer-creation.js n=1024 len=1024 type='slow-allocUnsafe'                -2.20 %       ±5.04% ±6.71%  ±8.74%
 buffers/buffer-creation.js n=1024 len=10 type='buffer()'                           1.13 %       ±4.43% ±5.93%  ±7.80%
 buffers/buffer-creation.js n=1024 len=10 type='fast-alloc'                        -2.44 %       ±3.94% ±5.24%  ±6.82%
 buffers/buffer-creation.js n=1024 len=10 type='fast-alloc-fill'                   -0.75 %       ±3.89% ±5.18%  ±6.75%
 buffers/buffer-creation.js n=1024 len=10 type='fast-allocUnsafe'           **     -6.73 %       ±4.48% ±5.99%  ±7.86%
 buffers/buffer-creation.js n=1024 len=10 type='slow'                              -2.41 %       ±4.02% ±5.34%  ±6.95%
 buffers/buffer-creation.js n=1024 len=10 type='slow-allocUnsafe'            *     -7.52 %       ±6.27% ±8.37% ±10.95%
 buffers/buffer-creation.js n=1024 len=2048 type='buffer()'                        -4.40 %       ±5.84% ±7.77% ±10.12%
 buffers/buffer-creation.js n=1024 len=2048 type='fast-alloc'                      -0.74 %       ±6.50% ±8.67% ±11.30%
 buffers/buffer-creation.js n=1024 len=2048 type='fast-alloc-fill'                 -1.92 %       ±7.18% ±9.55% ±12.43%
 buffers/buffer-creation.js n=1024 len=2048 type='fast-allocUnsafe'                -2.69 %       ±3.37% ±4.50%  ±5.88%
 buffers/buffer-creation.js n=1024 len=2048 type='slow'                            -4.27 %       ±6.13% ±8.15% ±10.61%
 buffers/buffer-creation.js n=1024 len=2048 type='slow-allocUnsafe'                -1.12 %       ±6.26% ±8.33% ±10.84%
 buffers/buffer-creation.js n=1024 len=4096 type='buffer()'                        -2.77 %       ±4.19% ±5.57%  ±7.25%
 buffers/buffer-creation.js n=1024 len=4096 type='fast-alloc'                      -1.85 %       ±5.08% ±6.76%  ±8.80%
 buffers/buffer-creation.js n=1024 len=4096 type='fast-alloc-fill'                  1.43 %       ±4.59% ±6.11%  ±7.96%
 buffers/buffer-creation.js n=1024 len=4096 type='fast-allocUnsafe'                -0.15 %       ±4.74% ±6.31%  ±8.22%
 buffers/buffer-creation.js n=1024 len=4096 type='slow'                            -4.61 %       ±5.55% ±7.38%  ±9.61%
 buffers/buffer-creation.js n=1024 len=4096 type='slow-allocUnsafe'                -2.96 %       ±4.97% ±6.61%  ±8.61%
 buffers/buffer-creation.js n=1024 len=8192 type='buffer()'                         2.70 %       ±4.78% ±6.35%  ±8.27%
 buffers/buffer-creation.js n=1024 len=8192 type='fast-alloc'                      -1.90 %       ±4.93% ±6.56%  ±8.55%
 buffers/buffer-creation.js n=1024 len=8192 type='fast-alloc-fill'                  3.10 %       ±5.35% ±7.12%  ±9.27%
 buffers/buffer-creation.js n=1024 len=8192 type='fast-allocUnsafe'                -0.75 %       ±5.54% ±7.39%  ±9.65%
 buffers/buffer-creation.js n=1024 len=8192 type='slow'                            -3.67 %       ±5.33% ±7.09%  ±9.22%
 buffers/buffer-creation.js n=1024 len=8192 type='slow-allocUnsafe'                -1.34 %       ±5.62% ±7.48%  ±9.73%

Be aware that when doing many comparisions the risk of a false-positive
result increases. In this case there are 30 comparisions, you can thus
expect the following amount of false-positive results:
  1.50 false positives, when considering a   5% risk acceptance (*, **, ***),
  0.30 false positives, when considering a   1% risk acceptance (**, ***),
  0.03 false positives, when considering a 0.1% risk acceptance (***)
Notifying upstream projects of job completion
Finished: SUCCESS

```
</details>

<details>
<summary>Significant impact</summary>

```
                                                                    confidence improvement accuracy (*)   (**)   (***)
 buffers/buffer-creation.js n=1024 len=10 type='fast-allocUnsafe'           **     -6.73 %       ±4.48% ±5.99%  ±7.86%
 buffers/buffer-creation.js n=1024 len=10 type='slow-allocUnsafe'            *     -7.52 %       ±6.27% ±8.37% ±10.95%
```
</details>
