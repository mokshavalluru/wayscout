"""Ant Colony Optimization for the Travelling Salesman Problem (stop 0 is the start)."""
import numpy as np


def _length(t, d, closed):
    total = sum(d[t[i], t[i + 1]] for i in range(len(t) - 1))
    return total + (d[t[-1], t[0]] if closed else 0.0)


def _edges(t, closed):
    return zip(t, t[1:] + ([t[0]] if closed else []))


def _two_opt(t, d, closed):
    """Polish the best ant tour by reversing segments while it helps."""
    best, best_len, improved = t[:], _length(t, d, closed), True
    while improved:
        improved = False
        for i in range(1, len(best) - 1):
            for j in range(i + 1, len(best)):
                cand = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                cl = _length(cand, d, closed)
                if cl < best_len - 1e-9:
                    best, best_len, improved = cand, cl, True
    return best, best_len


def solve(dist, closed=True, ants=None, iterations=100,
          alpha=1.0, beta=3.0, rho=0.4, q=1.0, seed=None):
    """Return (visiting order, total length, best length per iteration)."""
    d = np.asarray(dist, dtype=float)
    n = len(d)
    if n <= 3:
        order = list(range(n))
        return order, _length(order, d, closed), []

    rng = np.random.default_rng(seed)
    ants = ants or min(max(n, 10), 30)
    eta = 1.0 / (d + 1e-6)              # desirability: closer is better
    np.fill_diagonal(eta, 0)
    tau = np.ones((n, n))               # pheromone
    best, best_len, history = None, float("inf"), []

    for _ in range(iterations):
        weights = (tau ** alpha) * (eta ** beta)
        tours = []
        for _ in range(ants):
            tour, seen = [0], np.zeros(n, bool)
            seen[0] = True
            while len(tour) < n:
                w = weights[tour[-1]].copy()
                w[seen] = 0
                s = w.sum()
                p = w / s if s > 0 else (~seen) / (~seen).sum()
                nxt = int(rng.choice(n, p=p))
                tour.append(nxt)
                seen[nxt] = True
            tours.append(tour)

        lens = [_length(t, d, closed) for t in tours]
        i = int(np.argmin(lens))
        if lens[i] < best_len:
            best, best_len = tours[i], lens[i]

        tau *= 1 - rho                  # evaporation
        for t, L in zip(tours, lens):   # every ant leaves a trail
            for a, b in _edges(t, closed):
                tau[a, b] += q / L
                tau[b, a] += q / L
        for a, b in _edges(best, closed):   # elitist boost on the best route
            tau[a, b] += 2 * q / best_len
            tau[b, a] += 2 * q / best_len
        tau = np.clip(tau, 1e-6, None)
        history.append(best_len)

    best, best_len = _two_opt(best, d, closed)
    history.append(best_len)
    return best, best_len, history
